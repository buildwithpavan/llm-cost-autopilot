import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDb,
  createPool,
  detectCostAnomalies,
  runMigrations,
  type AnomalyConfig,
  type Db,
} from "../src/index.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

const PRICING = "anom-unit-pricing";
const CLIENT = "anom-unit";
const H = (h: number) => `2026-10-01T${String(h).padStart(2, "0")}:30:00Z`;

const CONFIG: AnomalyConfig = {
  minHistory: 6,
  relThreshold: "0.5",
  criticalRelThreshold: "1",
  minAbsoluteUsd: "0.010000",
};

function ev(iso: string, est: string) {
  return {
    event_id: randomUUID(),
    received_at: iso,
    client_id: CLIENT,
    decision_source: "autopilot" as const,
    shadowed_source: null,
    effective_provider_id: "pA",
    effective_model_id: "mA",
    attempts: JSON.stringify([]),
    aggregated_input_tokens: 1,
    aggregated_output_tokens: 1,
    total_latency_ms: 1,
    terminal_error_class: "none",
    estimated_cost_usd: est,
    actual_cost_usd: null,
    pricing_table_version_id: PRICING,
    reconciled: null,
    routing_rationale: JSON.stringify({}),
  };
}

gated("detectCostAnomalies (deterministic, exact-decimal)", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db.insertInto("pricing_tables").values({ version_id: PRICING, effective_from: new Date(), is_active: false }).execute();
    const rows = [];
    for (let h = 0; h <= 7; h++) rows.push(ev(H(h), "0.100000"));
    rows.push(ev(H(8), "0.300000")); // critical spike
    await db.insertInto("telemetry_events").values(rows).execute();
  });

  afterAll(async () => {
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db.destroy();
  });

  const base = { since: "2026-10-01T00:00:00Z", until: "2026-10-01T09:00:00Z", bucket: "hour" as const, clientId: CLIENT };

  it("detects the completed spike when now is past the bucket", async () => {
    const res = await detectCostAnomalies(db, { ...base, now: "2026-10-01T09:00:00Z" }, CONFIG);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ bucketStart: "2026-10-01T08:00:00Z", severity: "critical", historicalBucketCount: 8 });
  });

  it("excludes the active (incomplete) bucket when now falls inside it", async () => {
    // now at 08:30 → the 08:00 bucket is still in progress and must not be evaluated.
    const res = await detectCostAnomalies(db, { ...base, now: "2026-10-01T08:30:00Z" }, CONFIG);
    expect(res).toHaveLength(0);
  });

  it("excludes the target from its own baseline (exact decimal baseline)", async () => {
    const res = await detectCostAnomalies(db, { ...base, now: "2026-10-01T09:00:00Z" }, CONFIG);
    // baseline is the mean of the eight preceding $0.10 buckets, not diluted by the $0.30 target.
    expect(res[0]!.baselineEstimatedCostUsd).toBe("0.100000");
    expect(res[0]!.deviationUsd).toBe("0.200000");
    expect(res[0]!.deviationPercent).toBe("200.00");
  });
});
