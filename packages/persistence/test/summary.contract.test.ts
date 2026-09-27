import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { aggregateRecentTelemetry } from "../src/telemetry/summary.js";
import { createDb, createPool, type Db } from "../src/db/schema.js";
import { runMigrations } from "../src/db/migrate.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

const PRICING = "summary-test-pricing";
const CLIENTS = ["summary-agg", "summary-window", "summary-bulk", "summary-none"];

interface EvInput {
  clientId: string;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  estimated: string;
  actual: string | null;
  receivedAt?: Date;
}

function evRow(o: EvInput) {
  return {
    event_id: randomUUID(),
    received_at: (o.receivedAt ?? new Date()).toISOString(),
    client_id: o.clientId,
    decision_source: "autopilot" as const,
    shadowed_source: null,
    effective_provider_id: o.providerId,
    effective_model_id: o.modelId,
    attempts: JSON.stringify([]),
    aggregated_input_tokens: o.inputTokens,
    aggregated_output_tokens: o.outputTokens,
    total_latency_ms: 100,
    terminal_error_class: "none",
    estimated_cost_usd: o.estimated,
    actual_cost_usd: o.actual,
    pricing_table_version_id: PRICING,
    reconciled: o.actual == null ? null : true,
    routing_rationale: JSON.stringify({}),
  };
}

gated("telemetry summary aggregation", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);

    for (const c of CLIENTS) {
      await db.deleteFrom("telemetry_events").where("client_id", "=", c).execute();
    }
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db
      .insertInto("pricing_tables")
      .values({ version_id: PRICING, effective_from: new Date(), is_active: false })
      .execute();

    // MAIN dataset (client summary-agg).
    await db
      .insertInto("telemetry_events")
      .values([
        evRow({ clientId: "summary-agg", providerId: "sum-prov-a", modelId: "sum-a:m1", inputTokens: 10, outputTokens: 5, estimated: "0.000010", actual: "0.000010" }),
        evRow({ clientId: "summary-agg", providerId: "sum-prov-a", modelId: "sum-a:m1", inputTokens: 20, outputTokens: 10, estimated: "0.000020", actual: null }),
        evRow({ clientId: "summary-agg", providerId: "sum-prov-a", modelId: "sum-a:m2", inputTokens: 30, outputTokens: 15, estimated: "0.000030", actual: "0.000030" }),
        evRow({ clientId: "summary-agg", providerId: "sum-prov-b", modelId: "sum-b:m3", inputTokens: 40, outputTokens: 20, estimated: "0.000040", actual: null }),
      ])
      .execute();

    // WINDOW dataset (client summary-window): one recent, one aged.
    await db
      .insertInto("telemetry_events")
      .values([
        evRow({ clientId: "summary-window", providerId: "sum-prov-a", modelId: "sum-a:m1", inputTokens: 1, outputTokens: 1, estimated: "0.000005", actual: "0.000005" }),
        evRow({ clientId: "summary-window", providerId: "sum-prov-a", modelId: "sum-a:m1", inputTokens: 9, outputTokens: 9, estimated: "9.999999", actual: "9.999999", receivedAt: new Date("2026-09-02T00:00:00.000Z") }),
      ])
      .execute();

    // BULK dataset (client summary-bulk): > 5000 events.
    const bulk = [];
    for (let i = 0; i < 5001; i++) {
      bulk.push(
        evRow({ clientId: "summary-bulk", providerId: "sum-prov-a", modelId: "sum-a:m1", inputTokens: 1, outputTokens: 1, estimated: "0.000001", actual: "0.000001" }),
      );
    }
    for (let i = 0; i < bulk.length; i += 1000) {
      await db.insertInto("telemetry_events").values(bulk.slice(i, i + 1000)).execute();
    }
  });

  afterAll(async () => {
    for (const c of CLIENTS) {
      await db.deleteFrom("telemetry_events").where("client_id", "=", c).execute();
    }
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db.destroy();
  });

  it("aggregates exact totals, tokens, costs, and pending count", async () => {
    const s = await aggregateRecentTelemetry(db, { clientId: "summary-agg" });
    expect(s.totals.requestCount).toBe(4);
    expect(s.totals.inputTokens).toBe(100);
    expect(s.totals.outputTokens).toBe(50);
    expect(s.totals.estimatedCostUsd).toBe("0.000100");
    expect(s.totals.actualCostUsd).toBe("0.000040");
    expect(s.totals.pendingActualCostCount).toBe(2);
  });

  it("groups by provider with deterministic cost-desc ordering", async () => {
    const s = await aggregateRecentTelemetry(db, { clientId: "summary-agg" });
    expect(s.byProvider.map((p) => p.providerId)).toEqual(["sum-prov-a", "sum-prov-b"]);
    const a = s.byProvider[0]!;
    expect(a.requestCount).toBe(3);
    expect(a.inputTokens).toBe(60);
    expect(a.outputTokens).toBe(30);
    expect(a.estimatedCostUsd).toBe("0.000060");
    expect(a.actualCostUsd).toBe("0.000040");
    expect(a.pendingActualCostCount).toBe(1);
    const b = s.byProvider[1]!;
    expect(b.requestCount).toBe(1);
    expect(b.estimatedCostUsd).toBe("0.000040");
    expect(Number(b.actualCostUsd)).toBe(0);
    expect(b.pendingActualCostCount).toBe(1);
  });

  it("groups by model with deterministic ordering and cost tiebreak", async () => {
    const s = await aggregateRecentTelemetry(db, { clientId: "summary-agg" });
    expect(s.byModel.map((m) => `${m.providerId}/${m.modelId}`)).toEqual([
      "sum-prov-b/sum-b:m3",
      "sum-prov-a/sum-a:m1",
      "sum-prov-a/sum-a:m2",
    ]);
    const m1 = s.byModel.find((m) => m.modelId === "sum-a:m1")!;
    expect(m1.requestCount).toBe(2);
    expect(m1.estimatedCostUsd).toBe("0.000030");
    expect(m1.actualCostUsd).toBe("0.000010");
    expect(m1.pendingActualCostCount).toBe(1);
  });

  it("filters by providerId", async () => {
    const s = await aggregateRecentTelemetry(db, { clientId: "summary-agg", providerId: "sum-prov-a" });
    expect(s.totals.requestCount).toBe(3);
    expect(s.totals.estimatedCostUsd).toBe("0.000060");
    expect(s.byProvider).toHaveLength(1);
  });

  it("filters by modelId", async () => {
    const s = await aggregateRecentTelemetry(db, { clientId: "summary-agg", modelId: "sum-a:m1" });
    expect(s.totals.requestCount).toBe(2);
    expect(s.totals.estimatedCostUsd).toBe("0.000030");
    expect(s.byModel).toHaveLength(1);
  });

  it("filters by since/until window (excludes events outside the window)", async () => {
    const until = new Date();
    const since = new Date(until.getTime() - 2 * 86_400_000);
    const s = await aggregateRecentTelemetry(db, {
      clientId: "summary-window",
      since: since.toISOString(),
      until: until.toISOString(),
    });
    expect(s.totals.requestCount).toBe(1);
    expect(s.totals.estimatedCostUsd).toBe("0.000005");
  });

  it("returns empty totals and groups for a non-matching filter", async () => {
    const s = await aggregateRecentTelemetry(db, { clientId: "summary-none" });
    expect(s.totals.requestCount).toBe(0);
    expect(Number(s.totals.estimatedCostUsd)).toBe(0);
    expect(Number(s.totals.actualCostUsd)).toBe(0);
    expect(s.totals.pendingActualCostCount).toBe(0);
    expect(s.byProvider).toEqual([]);
    expect(s.byModel).toEqual([]);
  });

  it("aggregates over more than 5000 events without a pagination cap", async () => {
    const s = await aggregateRecentTelemetry(db, { clientId: "summary-bulk" });
    expect(s.totals.requestCount).toBe(5001);
    expect(s.totals.inputTokens).toBe(5001);
    expect(s.totals.outputTokens).toBe(5001);
    expect(s.totals.estimatedCostUsd).toBe("0.005001");
    expect(s.totals.actualCostUsd).toBe("0.005001");
    expect(s.totals.pendingActualCostCount).toBe(0);
  });
});
