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

const PRICING = "summary-contract-pricing";
const CLIENT = "summary-contract";

function evRow(o: {
  providerId: string;
  modelId: string;
  estimated: string;
  actual: string | null;
  inputTokens: number;
  outputTokens: number;
}) {
  return {
    event_id: randomUUID(),
    received_at: new Date().toISOString(),
    client_id: CLIENT,
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

gated("contract: GET /v1/telemetry/summary", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let secret: string;
  let writer: TelemetryWriter;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
    await db.deleteFrom("api_keys").where("label", "=", CLIENT).execute();
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db
      .insertInto("pricing_tables")
      .values({ version_id: PRICING, effective_from: new Date(), is_active: false })
      .execute();
    await db
      .insertInto("telemetry_events")
      .values([
        evRow({ providerId: "sc-prov-1", modelId: "sc:m1", estimated: "0.000010", actual: "0.000010", inputTokens: 10, outputTokens: 5 }),
        evRow({ providerId: "sc-prov-1", modelId: "sc:m1", estimated: "0.000020", actual: null, inputTokens: 20, outputTokens: 10 }),
        evRow({ providerId: "sc-prov-2", modelId: "sc:m2", estimated: "0.000030", actual: "0.000030", inputTokens: 30, outputTokens: 15 }),
      ])
      .execute();

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
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();
    await db.deleteFrom("api_keys").where("label", "=", CLIENT).execute();
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db.destroy();
  });

  it("returns 401 without Bearer", async () => {
    const res = await supertest(app.server).get("/v1/telemetry/summary");
    expect(res.status).toBe(401);
  });

  it("returns the aggregate response shape with decimal-string costs", async () => {
    const res = await supertest(app.server)
      .get(`/v1/telemetry/summary?clientId=${CLIENT}`)
      .set("authorization", `Bearer ${secret}`);
    expect(res.status).toBe(200);
    expect(res.body.window).toHaveProperty("since");
    expect(res.body.window).toHaveProperty("until");
    expect(Array.isArray(res.body.byProvider)).toBe(true);
    expect(Array.isArray(res.body.byModel)).toBe(true);

    const t = res.body.totals;
    expect(t.requestCount).toBe(3);
    expect(t.inputTokens).toBe(60);
    expect(t.outputTokens).toBe(30);
    expect(typeof t.estimatedCostUsd).toBe("string");
    expect(typeof t.actualCostUsd).toBe("string");
    expect(t.estimatedCostUsd).toBe("0.000060");
    expect(t.actualCostUsd).toBe("0.000040");
    expect(t.pendingActualCostCount).toBe(1);

    expect(res.body.byProvider).toHaveLength(2);
    expect(res.body.byModel).toHaveLength(2);
    // Never leaks raw event material.
    expect(JSON.stringify(res.body)).not.toMatch(/routingRationale|eventId|attempts|hashed/i);
  });

  it("applies providerId filter", async () => {
    const res = await supertest(app.server)
      .get(`/v1/telemetry/summary?clientId=${CLIENT}&providerId=sc-prov-1`)
      .set("authorization", `Bearer ${secret}`);
    expect(res.status).toBe(200);
    expect(res.body.totals.requestCount).toBe(2);
    expect(res.body.totals.estimatedCostUsd).toBe("0.000030");
  });

  it("applies modelId filter", async () => {
    const res = await supertest(app.server)
      .get(`/v1/telemetry/summary?clientId=${CLIENT}&modelId=sc:m2`)
      .set("authorization", `Bearer ${secret}`);
    expect(res.status).toBe(200);
    expect(res.body.totals.requestCount).toBe(1);
  });

  it("returns empty totals for a non-matching client filter", async () => {
    const res = await supertest(app.server)
      .get(`/v1/telemetry/summary?clientId=does-not-exist-${randomUUID()}`)
      .set("authorization", `Bearer ${secret}`);
    expect(res.status).toBe(200);
    expect(res.body.totals.requestCount).toBe(0);
    expect(res.body.byProvider).toEqual([]);
    expect(res.body.byModel).toEqual([]);
  });

  it("rejects an invalid date with 400 invalid_request", async () => {
    const res = await supertest(app.server)
      .get("/v1/telemetry/summary?since=not-a-date")
      .set("authorization", `Bearer ${secret}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_request");
  });

  it("rejects a window larger than the maximum with 400", async () => {
    const until = new Date();
    const since = new Date(until.getTime() - 40 * 86_400_000);
    const res = await supertest(app.server)
      .get(`/v1/telemetry/summary?since=${since.toISOString()}&until=${until.toISOString()}`)
      .set("authorization", `Bearer ${secret}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_request");
    expect(res.body.error.message).toMatch(/maximum/i);
  });

  it("rejects since >= until with 400", async () => {
    const now = new Date();
    const res = await supertest(app.server)
      .get(`/v1/telemetry/summary?since=${now.toISOString()}&until=${now.toISOString()}`)
      .set("authorization", `Bearer ${secret}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_request");
  });
});
