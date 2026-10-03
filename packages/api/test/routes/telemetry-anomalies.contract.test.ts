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

const PRICING = "anomaly-contract-pricing";
const CLIENTS = [
  "anom-main", "anom-crit", "anom-tiny", "anom-normal",
  "anom-prov", "anom-model", "anom-bulk", "anom-early", "anom-order",
];
const KEY_CLIENT = "anom-main";
const H = (h: number) => `2026-10-01T${String(h).padStart(2, "0")}:30:00Z`;

function ev(client: string, provider: string, model: string, iso: string, est: string) {
  return {
    event_id: randomUUID(),
    received_at: iso,
    client_id: client,
    decision_source: "autopilot" as const,
    shadowed_source: null,
    effective_provider_id: provider,
    effective_model_id: model,
    attempts: JSON.stringify([]),
    aggregated_input_tokens: 1,
    aggregated_output_tokens: 1,
    total_latency_ms: 1,
    terminal_error_class: "none",
    estimated_cost_usd: est,
    actual_cost_usd: null, // pending — anomaly detection must ignore reconciliation
    pricing_table_version_id: PRICING,
    reconciled: null,
    routing_rationale: JSON.stringify({}),
  };
}

gated("contract: GET /v1/telemetry/anomalies", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let secret: string;
  let writer: TelemetryWriter;

  async function get(qs: string) {
    return supertest(app.server)
      .get(`/v1/telemetry/anomalies?${qs}`)
      .set("authorization", `Bearer ${secret}`);
  }

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
    for (const c of CLIENTS) {
      await db.deleteFrom("api_keys").where("label", "=", c).execute();
      await db.deleteFrom("telemetry_events").where("client_id", "=", c).execute();
    }
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db.insertInto("pricing_tables").values({ version_id: PRICING, effective_from: new Date(), is_active: false }).execute();

    const rows: ReturnType<typeof ev>[] = [];
    // Baseline $0.10 for hours 0..7, then a warning spike $0.16 at hour 8.
    for (let h = 0; h <= 7; h++) rows.push(ev("anom-main", "pA", "mA", H(h), "0.100000"));
    rows.push(ev("anom-main", "pA", "mA", H(8), "0.160000"));
    // Critical spike $0.30 at hour 8.
    for (let h = 0; h <= 7; h++) rows.push(ev("anom-crit", "pA", "mA", H(h), "0.100000"));
    rows.push(ev("anom-crit", "pA", "mA", H(8), "0.300000"));
    // Tiny: baseline $0.001, spike $0.005 (400% but below the $0.01 absolute floor).
    for (let h = 0; h <= 7; h++) rows.push(ev("anom-tiny", "pA", "mA", H(h), "0.001000"));
    rows.push(ev("anom-tiny", "pA", "mA", H(8), "0.005000"));
    // Normal variation: +20% (< 50% relative threshold).
    for (let h = 0; h <= 7; h++) rows.push(ev("anom-normal", "pA", "mA", H(h), "0.100000"));
    rows.push(ev("anom-normal", "pA", "mA", H(8), "0.120000"));
    // Provider filter: pA has a spike; pB is constant-high. Unfiltered → no anomaly.
    for (let h = 0; h <= 7; h++) rows.push(ev("anom-prov", "pA", "mA", H(h), "0.100000"));
    rows.push(ev("anom-prov", "pA", "mA", H(8), "0.160000"));
    for (let h = 0; h <= 8; h++) rows.push(ev("anom-prov", "pB", "mB", H(h), "1.000000"));
    // Model filter: mLow has a spike; mHigh is constant-high (same provider).
    for (let h = 0; h <= 7; h++) rows.push(ev("anom-model", "pM", "mLow", H(h), "0.100000"));
    rows.push(ev("anom-model", "pM", "mLow", H(8), "0.160000"));
    for (let h = 0; h <= 8; h++) rows.push(ev("anom-model", "pM", "mHigh", H(h), "1.000000"));
    // Early spike with insufficient history (minHistory = 6, only 2 preceding).
    rows.push(ev("anom-early", "pA", "mA", H(0), "0.100000"));
    rows.push(ev("anom-early", "pA", "mA", H(1), "0.100000"));
    rows.push(ev("anom-early", "pA", "mA", H(2), "0.300000"));
    // Ordering: two critical spikes at hour 8 and hour 12.
    for (let h = 0; h <= 7; h++) rows.push(ev("anom-order", "pA", "mA", H(h), "0.100000"));
    rows.push(ev("anom-order", "pA", "mA", H(8), "0.300000"));
    for (let h = 9; h <= 11; h++) rows.push(ev("anom-order", "pA", "mA", H(h), "0.100000"));
    rows.push(ev("anom-order", "pA", "mA", H(12), "0.300000"));
    // High volume: 200 events per baseline hour, 200 at the spike (1800 total).
    for (let h = 0; h <= 7; h++) for (let i = 0; i < 200; i++) rows.push(ev("anom-bulk", "pA", "mA", H(h), "0.000500"));
    for (let i = 0; i < 200; i++) rows.push(ev("anom-bulk", "pA", "mA", H(8), "0.000800"));

    for (let i = 0; i < rows.length; i += 1000) {
      await db.insertInto("telemetry_events").values(rows.slice(i, i + 1000)).execute();
    }

    const registry = createRegistry();
    registry.register(createMockAdapter({ providerId: "mock-cheap" }));
    const created = await createApiKey(db, { clientId: KEY_CLIENT, label: KEY_CLIENT });
    secret = created.secret;

    writer = createTelemetryWriter(db, { batchSize: 1, flushEveryMs: 0 });
    const config = loadConfig({
      ...process.env,
      DATABASE_URL,
      LCA_ANOMALY_MIN_HISTORY: "6",
      LCA_ANOMALY_REL_THRESHOLD: "0.5",
      LCA_ANOMALY_CRIT_REL_THRESHOLD: "1",
      LCA_ANOMALY_MIN_ABS_USD: "0.010000",
    });
    app = await buildServer({ config, db, registry, telemetryWriter: writer });
    await app.ready();
  });

  afterAll(async () => {
    await writer.close();
    await app.close();
    for (const c of CLIENTS) {
      await db.deleteFrom("telemetry_events").where("client_id", "=", c).execute();
      await db.deleteFrom("api_keys").where("label", "=", c).execute();
    }
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db.destroy();
  });

  const WIN9 = "bucket=hour&since=2026-10-01T00:00:00Z&until=2026-10-01T09:00:00Z";

  it("requires Bearer auth", async () => {
    const res = await supertest(app.server).get("/v1/telemetry/anomalies");
    expect(res.status).toBe(401);
  });

  it("rejects invalid bucket, since>=until, and oversized windows", async () => {
    expect((await get("bucket=week&since=2026-10-01T00:00:00Z&until=2026-10-01T09:00:00Z")).status).toBe(400);
    expect((await get("bucket=hour&since=2026-10-01T09:00:00Z&until=2026-10-01T09:00:00Z")).status).toBe(400);
    const tooBig = await get("bucket=day&since=2026-09-01T00:00:00Z&until=2026-10-15T00:00:00Z");
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.details.maxWindowDays).toBe(30);
  });

  it("flags a relative spike as warning with exact decimal fields and self-excluded baseline", async () => {
    const res = await get(`clientId=anom-main&${WIN9}`);
    expect(res.status).toBe(200);
    expect(res.body.bucket).toBe("hour");
    expect(res.body.thresholds).toMatchObject({ minHistory: 6, relThreshold: "0.5", criticalRelThreshold: "1", minAbsoluteUsd: "0.010000" });
    expect(res.body.anomalies).toHaveLength(1);
    const a = res.body.anomalies[0];
    expect(a).toEqual({
      bucketStart: "2026-10-01T08:00:00Z",
      estimatedCostUsd: "0.160000",
      baselineEstimatedCostUsd: "0.100000", // baseline excludes the 0.16 target itself
      deviationUsd: "0.060000",
      deviationPercent: "60.00",
      historicalBucketCount: 8,
      severity: "warning",
    });
  });

  it("flags a large spike as critical", async () => {
    const res = await get(`clientId=anom-crit&${WIN9}`);
    expect(res.body.anomalies).toHaveLength(1);
    expect(res.body.anomalies[0]).toMatchObject({
      estimatedCostUsd: "0.300000",
      baselineEstimatedCostUsd: "0.100000",
      deviationUsd: "0.200000",
      deviationPercent: "200.00",
      severity: "critical",
    });
  });

  it("does not flag a spike below the absolute floor (both thresholds required)", async () => {
    const res = await get(`clientId=anom-tiny&${WIN9}`);
    expect(res.body.anomalies).toHaveLength(0);
  });

  it("does not flag normal variation under the relative threshold", async () => {
    const res = await get(`clientId=anom-normal&${WIN9}`);
    expect(res.body.anomalies).toHaveLength(0);
  });

  it("does not evaluate buckets without enough history", async () => {
    const res = await get("clientId=anom-early&bucket=hour&since=2026-10-01T00:00:00Z&until=2026-10-01T03:00:00Z");
    expect(res.body.anomalies).toHaveLength(0);
  });

  it("provider filter affects both target and baseline", async () => {
    const unfiltered = await get(`clientId=anom-prov&${WIN9}`);
    expect(unfiltered.body.anomalies).toHaveLength(0);
    const filtered = await get(`clientId=anom-prov&providerId=pA&${WIN9}`);
    expect(filtered.body.anomalies).toHaveLength(1);
    expect(filtered.body.anomalies[0]).toMatchObject({ baselineEstimatedCostUsd: "0.100000", severity: "warning" });
  });

  it("model filter affects both target and baseline", async () => {
    const unfiltered = await get(`clientId=anom-model&${WIN9}`);
    expect(unfiltered.body.anomalies).toHaveLength(0);
    const filtered = await get(`clientId=anom-model&modelId=mLow&${WIN9}`);
    expect(filtered.body.anomalies).toHaveLength(1);
    expect(filtered.body.anomalies[0]).toMatchObject({ baselineEstimatedCostUsd: "0.100000", severity: "warning" });
  });

  it("returns anomalies ordered by bucket time (never ranked)", async () => {
    const res = await get("clientId=anom-order&bucket=hour&since=2026-10-01T00:00:00Z&until=2026-10-01T13:00:00Z");
    expect(res.body.anomalies).toHaveLength(2);
    expect(res.body.anomalies[0].bucketStart).toBe("2026-10-01T08:00:00Z");
    expect(res.body.anomalies[1].bucketStart).toBe("2026-10-01T12:00:00Z");
    expect(res.body.anomalies[0].bucketStart < res.body.anomalies[1].bucketStart).toBe(true);
  });

  it("aggregates thousands of events per bucket without an event cap", async () => {
    const res = await get(`clientId=anom-bulk&${WIN9}`);
    expect(res.body.anomalies).toHaveLength(1);
    expect(res.body.anomalies[0]).toMatchObject({
      estimatedCostUsd: "0.160000", // 200 × 0.000800
      baselineEstimatedCostUsd: "0.100000", // 200 × 0.000500
      historicalBucketCount: 8,
      severity: "warning",
    });
  });

  it("returns an empty list when there are no anomalies", async () => {
    const res = await get(`clientId=does-not-exist-${randomUUID()}&${WIN9}`);
    expect(res.status).toBe(200);
    expect(res.body.anomalies).toEqual([]);
  });
});
