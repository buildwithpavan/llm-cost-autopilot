import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";

import {
  createApiKey,
  createDb,
  createPool,
  createTelemetryWriter,
  runMigrations,
  type Db,
  type TelemetryWriter,
} from "@lca/persistence";
import { createMockAdapter, createRegistry } from "@lca/providers";

import { buildServer } from "../../src/server.js";
import { loadConfig } from "../../src/config.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

const PRICING = "timeseries-contract-pricing";
const CLIENT = "timeseries-contract";
const CLIENT2 = "timeseries-contract-other";

function evRow(o: {
  client?: string;
  receivedAt: string;
  providerId: string;
  modelId: string;
  estimated: string;
  actual: string | null;
  inputTokens: number;
  outputTokens: number;
}) {
  return {
    event_id: randomUUID(),
    received_at: o.receivedAt,
    client_id: o.client ?? CLIENT,
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

gated("contract: GET /v1/telemetry/timeseries", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let secret: string;
  let writer: TelemetryWriter;

  async function get(qs: string) {
    return supertest(app.server)
      .get(`/v1/telemetry/timeseries?${qs}`)
      .set("authorization", `Bearer ${secret}`);
  }

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
    for (const c of [CLIENT, CLIENT2]) {
      await db.deleteFrom("api_keys").where("label", "=", c).execute();
      await db.deleteFrom("telemetry_events").where("client_id", "=", c).execute();
    }
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db
      .insertInto("pricing_tables")
      .values({ version_id: PRICING, effective_from: new Date(), is_active: false })
      .execute();

    await db
      .insertInto("telemetry_events")
      .values([
        // Hour 10:00 (two events), one reconciled + one pending.
        evRow({ receivedAt: "2026-10-05T10:15:00Z", providerId: "ts-p1", modelId: "ts:m1", estimated: "0.000010", actual: "0.000010", inputTokens: 10, outputTokens: 5 }),
        evRow({ receivedAt: "2026-10-05T10:45:00Z", providerId: "ts-p1", modelId: "ts:m1", estimated: "0.000020", actual: null, inputTokens: 20, outputTokens: 10 }),
        // Hour 11:00 (one event).
        evRow({ receivedAt: "2026-10-05T11:30:00Z", providerId: "ts-p2", modelId: "ts:m2", estimated: "0.000030", actual: "0.000030", inputTokens: 30, outputTokens: 15 }),
        // Next day.
        evRow({ receivedAt: "2026-10-06T09:00:00Z", providerId: "ts-p1", modelId: "ts:m1", estimated: "0.000040", actual: null, inputTokens: 40, outputTokens: 20 }),
        // Another client in hour 10:00 — must be excluded by clientId filter.
        evRow({ client: CLIENT2, receivedAt: "2026-10-05T10:20:00Z", providerId: "ts-p1", modelId: "ts:m1", estimated: "9.000000", actual: "9.000000", inputTokens: 999, outputTokens: 999 }),
      ])
      .execute();

    // High volume: 3000 events in a single hour bucket to prove there is no
    // application-level event cap (pure SQL aggregation).
    const bulk = Array.from({ length: 3000 }, (_, i) =>
      evRow({
        receivedAt: `2026-10-20T05:${String(i % 60).padStart(2, "0")}:00Z`,
        providerId: "ts-bulk",
        modelId: "ts:bulk",
        estimated: "0.000001",
        actual: "0.000001",
        inputTokens: 1,
        outputTokens: 1,
      }),
    );
    for (let i = 0; i < bulk.length; i += 1000) {
      await db.insertInto("telemetry_events").values(bulk.slice(i, i + 1000)).execute();
    }

    const registry = createRegistry();
    registry.register(createMockAdapter({ providerId: "mock-cheap" }));
    const created = await createApiKey(db, { clientId: CLIENT, label: CLIENT });
    secret = created.secret;

    writer = createTelemetryWriter(db, { batchSize: 1, flushEveryMs: 0 });
    const config = loadConfig({ ...process.env, DATABASE_URL });
    app = await buildServer({ config, db, registry, telemetryWriter: writer });
    await app.ready();
  });

  afterAll(async () => {
    await writer.close();
    await app.close();
    for (const c of [CLIENT, CLIENT2]) {
      await db.deleteFrom("telemetry_events").where("client_id", "=", c).execute();
      await db.deleteFrom("api_keys").where("label", "=", c).execute();
    }
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db.destroy();
  });

  it("requires Bearer auth", async () => {
    const res = await supertest(app.server).get("/v1/telemetry/timeseries");
    expect(res.status).toBe(401);
  });

  it("rejects an invalid bucket", async () => {
    const res = await get("bucket=week&since=2026-10-05T10:00:00Z&until=2026-10-05T12:00:00Z");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_request");
  });

  it("rejects since >= until", async () => {
    const res = await get("bucket=hour&since=2026-10-05T12:00:00Z&until=2026-10-05T12:00:00Z");
    expect(res.status).toBe(400);
  });

  it("rejects a window larger than the maximum", async () => {
    const res = await get("bucket=day&since=2026-09-01T00:00:00Z&until=2026-10-15T00:00:00Z");
    expect(res.status).toBe(400);
    expect(res.body.error.details.maxWindowDays).toBe(30);
  });

  it("aggregates hourly buckets with exact decimal costs and pending/reconciled counts", async () => {
    const res = await get(`clientId=${CLIENT}&bucket=hour&since=2026-10-05T10:00:00Z&until=2026-10-05T12:00:00Z`);
    expect(res.status).toBe(200);
    expect(res.body.bucket).toBe("hour");
    expect(res.body.window).toEqual({ since: "2026-10-05T10:00:00.000Z", until: "2026-10-05T12:00:00.000Z" });
    const b = res.body.buckets;
    expect(b).toHaveLength(2);

    expect(b[0].bucketStart).toBe("2026-10-05T10:00:00Z");
    expect(b[0].requestCount).toBe(2);
    expect(b[0].inputTokens).toBe(30);
    expect(b[0].outputTokens).toBe(15);
    expect(b[0].estimatedCostUsd).toBe("0.000030");
    expect(b[0].actualCostUsd).toBe("0.000010");
    expect(b[0].pendingActualCostCount).toBe(1);
    expect(b[0].reconciledCount).toBe(1);

    expect(b[1].bucketStart).toBe("2026-10-05T11:00:00Z");
    expect(b[1].requestCount).toBe(1);
    expect(b[1].estimatedCostUsd).toBe("0.000030");
    expect(b[1].actualCostUsd).toBe("0.000030");
    expect(b[1].pendingActualCostCount).toBe(0);
    expect(b[1].reconciledCount).toBe(1);
  });

  it("zero-fills contiguous hourly buckets in ascending order", async () => {
    const res = await get(`clientId=${CLIENT}&bucket=hour&since=2026-10-05T10:00:00Z&until=2026-10-05T13:00:00Z`);
    const b = res.body.buckets;
    expect(b.map((x: { bucketStart: string }) => x.bucketStart)).toEqual([
      "2026-10-05T10:00:00Z",
      "2026-10-05T11:00:00Z",
      "2026-10-05T12:00:00Z",
    ]);
    // 12:00 has no activity.
    expect(b[2].requestCount).toBe(0);
    expect(b[2].inputTokens).toBe(0);
    expect(b[2].estimatedCostUsd).toBe("0");
    expect(b[2].actualCostUsd).toBe("0");
    expect(b[2].pendingActualCostCount).toBe(0);
  });

  it("aggregates daily buckets", async () => {
    const res = await get(`clientId=${CLIENT}&bucket=day&since=2026-10-05T00:00:00Z&until=2026-10-07T00:00:00Z`);
    const b = res.body.buckets;
    expect(b).toHaveLength(2);
    expect(b[0].bucketStart).toBe("2026-10-05T00:00:00Z");
    expect(b[0].requestCount).toBe(3);
    expect(b[0].inputTokens).toBe(60);
    expect(b[0].outputTokens).toBe(30);
    expect(b[0].estimatedCostUsd).toBe("0.000060");
    expect(b[0].actualCostUsd).toBe("0.000040");
    expect(b[0].pendingActualCostCount).toBe(1);
    expect(b[0].reconciledCount).toBe(2);
    expect(b[1].bucketStart).toBe("2026-10-06T00:00:00Z");
    expect(b[1].requestCount).toBe(1);
    expect(b[1].actualCostUsd).toBe("0");
    expect(b[1].pendingActualCostCount).toBe(1);
  });

  it("applies the provider filter", async () => {
    const res = await get(`clientId=${CLIENT}&providerId=ts-p2&bucket=hour&since=2026-10-05T10:00:00Z&until=2026-10-05T12:00:00Z`);
    const b = res.body.buckets;
    expect(b[0].requestCount).toBe(0);
    expect(b[1].requestCount).toBe(1);
  });

  it("applies the model filter", async () => {
    const res = await get(`clientId=${CLIENT}&modelId=ts:m1&bucket=day&since=2026-10-05T00:00:00Z&until=2026-10-07T00:00:00Z`);
    const b = res.body.buckets;
    // ts:m1 events: two on 10-05 (hour 10) + one on 10-06.
    expect(b[0].requestCount).toBe(2);
    expect(b[1].requestCount).toBe(1);
  });

  it("excludes events from other clients", async () => {
    const res = await get(`clientId=${CLIENT}&bucket=hour&since=2026-10-05T10:00:00Z&until=2026-10-05T11:00:00Z`);
    const b = res.body.buckets;
    expect(b).toHaveLength(1);
    expect(b[0].requestCount).toBe(2); // the CLIENT2 event in this hour is excluded
    expect(b[0].estimatedCostUsd).toBe("0.000030"); // not polluted by CLIENT2's 9.000000
  });

  it("returns all-zero buckets for an empty window", async () => {
    const res = await get(`clientId=${CLIENT}&bucket=day&since=2026-10-10T00:00:00Z&until=2026-10-11T00:00:00Z`);
    const b = res.body.buckets;
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ bucketStart: "2026-10-10T00:00:00Z", requestCount: 0, estimatedCostUsd: "0" });
  });

  it("aggregates thousands of events in one bucket without an event cap", async () => {
    const res = await get(`clientId=${CLIENT}&bucket=hour&since=2026-10-20T05:00:00Z&until=2026-10-20T06:00:00Z`);
    const b = res.body.buckets;
    expect(b).toHaveLength(1);
    expect(b[0].requestCount).toBe(3000);
    expect(b[0].inputTokens).toBe(3000);
    expect(b[0].estimatedCostUsd).toBe("0.003000");
    expect(b[0].actualCostUsd).toBe("0.003000");
  });
});
