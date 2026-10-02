import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Budget } from "@lca/core";

import { computeBudgetMetrics } from "../src/budgets/metrics.js";
import { createDb, createPool, type Db } from "../src/db/schema.js";
import { runMigrations } from "../src/db/migrate.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

const CLIENT = "bm-client";
const PRICING = "bm-pricing";

let seq = 0;
function bud(over: Partial<Budget>): Budget {
  return {
    budgetId: `budget_bm_${seq++}`,
    scope: "client",
    clientId: CLIENT,
    period: "daily",
    limitUsd: "10.000000",
    action: "block",
    enabled: true,
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    ...over,
  };
}

gated("computeBudgetMetrics (operator budget gauge source)", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db
      .insertInto("pricing_tables")
      .values({ version_id: PRICING, effective_from: new Date(), is_active: false })
      .execute();
    // Persisted spend for CLIENT today = 2.000000.
    await db
      .insertInto("telemetry_events")
      .values({
        event_id: randomUUID(),
        received_at: new Date().toISOString(),
        client_id: CLIENT,
        decision_source: "autopilot",
        shadowed_source: null,
        effective_provider_id: "bm-prov",
        effective_model_id: "bm:model",
        attempts: JSON.stringify([]),
        aggregated_input_tokens: 1,
        aggregated_output_tokens: 1,
        total_latency_ms: 1,
        terminal_error_class: "none",
        estimated_cost_usd: "2.000000",
        actual_cost_usd: null,
        pricing_table_version_id: PRICING,
        reconciled: null,
        routing_rationale: JSON.stringify({}),
      })
      .execute();
  });

  afterAll(async () => {
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db.destroy();
  });

  beforeEach(() => {
    seq = 0;
  });

  it("returns 0 utilization and no alert when there are no enabled budgets", async () => {
    expect(await computeBudgetMetrics(db, [])).toEqual({ maxUtilization: 0, alertActive: false, evaluated: 0 });
  });

  it("one budget below limit → utilization correct, alert 0", async () => {
    const r = await computeBudgetMetrics(db, [bud({ limitUsd: "10.000000" })]);
    expect(r.maxUtilization).toBeCloseTo(0.2, 6);
    expect(r.alertActive).toBe(false);
  });

  it("one budget exactly at limit → utilization 1, alert 1 (exact Decimal boundary)", async () => {
    const r = await computeBudgetMetrics(db, [bud({ limitUsd: "2.000000" })]);
    expect(r.maxUtilization).toBe(1);
    expect(r.alertActive).toBe(true);
  });

  it("one budget over limit → utilization > 1, alert 1", async () => {
    const r = await computeBudgetMetrics(db, [bud({ limitUsd: "1.000000" })]);
    expect(r.maxUtilization).toBeCloseTo(2, 6);
    expect(r.alertActive).toBe(true);
  });

  it("multiple budgets → max utilization and alert are deterministic", async () => {
    const r = await computeBudgetMetrics(db, [
      bud({ limitUsd: "10.000000" }), // 0.2
      bud({ limitUsd: "4.000000" }), // 0.5
      bud({ limitUsd: "1.000000" }), // 2.0 → alert
    ]);
    expect(r.maxUtilization).toBeCloseTo(2, 6);
    expect(r.alertActive).toBe(true);
    expect(r.evaluated).toBe(3);
  });

  it("excludes disabled budgets", async () => {
    const r = await computeBudgetMetrics(db, [
      bud({ limitUsd: "10.000000" }), // enabled, 0.2
      bud({ limitUsd: "0.100000", enabled: false }), // would be 20 + alert, but disabled
    ]);
    expect(r.maxUtilization).toBeCloseTo(0.2, 6);
    expect(r.alertActive).toBe(false);
    expect(r.evaluated).toBe(1);
  });

  it("uses persisted spend only and does not mutate budget state", async () => {
    const before = (await db.selectFrom("spend_budgets").selectAll().execute()).length;
    await computeBudgetMetrics(db, [bud({ limitUsd: "10.000000" })]);
    const after = (await db.selectFrom("spend_budgets").selectAll().execute()).length;
    expect(after).toBe(before); // helper never writes budgets
  });
});
