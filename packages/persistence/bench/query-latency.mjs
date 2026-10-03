#!/usr/bin/env node
/**
 * Telemetry query-latency benchmark (Phase 17).
 *
 * Seeds a representative, bounded telemetry dataset, measures the real
 * aggregation/read functions over the 30-day window, then deletes the seeded
 * rows. Latency is reported for local comparison only — it is NOT a pass/fail
 * gate and must not gate the ordinary test suite (numbers depend on hardware,
 * cache state, and existing table size).
 *
 * Usage:
 *   DATABASE_URL=postgres://lca:lca@localhost:5432/lca node packages/persistence/bench/query-latency.mjs [rows]
 *   RUN_PERF=1 ... node packages/persistence/bench/query-latency.mjs 150000
 *
 * Also useful: run EXPLAIN (ANALYZE, BUFFERS) manually on the ORDER BY
 * received_at DESC / LIMIT pattern to confirm the telemetry_events_received_at
 * index is used for the unfiltered "recent events" read.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
const ROWS = Number(process.argv[2] ?? (process.env.RUN_PERF === "1" ? 150000 : 50000));
const PREFIX = "perf-bench-c";

const persistence = await import("../dist/index.js");
const { Pool } = pg;
const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });
const db = persistence.createDb(persistence.createPool(DATABASE_URL));

async function timeIt(label, fn, iters = 5) {
  await fn(); // warm
  const samples = [];
  for (let i = 0; i < iters; i++) {
    const t = process.hrtime.bigint();
    await fn();
    samples.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  samples.sort((a, b) => a - b);
  console.log(
    `  ${label.padEnd(44)} p50=${samples[Math.floor(samples.length / 2)].toFixed(1)}ms ` +
      `max=${samples[samples.length - 1].toFixed(1)}ms`,
  );
}

async function seed() {
  const existing = await pool.query(`SELECT count(*)::int n FROM telemetry_events WHERE client_id LIKE $1`, [`${PREFIX}%`]);
  const toAdd = ROWS - existing.rows[0].n;
  if (toAdd <= 0) {
    console.log(`seed: ${existing.rows[0].n} rows already present (>= ${ROWS})`);
    return;
  }
  console.log(`seed: inserting ${toAdd} representative rows (active pricing version)...`);
  await pool.query(
    `INSERT INTO telemetry_events (
        event_id, received_at, client_id, decision_source, shadowed_source,
        effective_provider_id, effective_model_id, attempts,
        aggregated_input_tokens, aggregated_output_tokens, total_latency_ms,
        terminal_error_class, estimated_cost_usd, actual_cost_usd,
        pricing_table_version_id, reconciled, routing_rationale)
     SELECT gen_random_uuid(),
        TIMESTAMPTZ '2026-10-03 00:00:00+00' - (random() * interval '29 days'),
        '${PREFIX}' || (floor(random()*8))::int, 'autopilot', NULL,
        CASE m WHEN 2 THEN 'mock-fast' ELSE 'mock-cheap' END,
        CASE m WHEN 0 THEN 'mock-cheap:small' WHEN 1 THEN 'mock-cheap:large' ELSE 'mock-fast:default' END,
        '[]'::jsonb,
        (100 + floor(random()*1000))::int, (50 + floor(random()*500))::int, (10 + floor(random()*200))::int,
        'none', round((random()*0.5)::numeric, 6), NULL,
        (SELECT version_id FROM pricing_tables WHERE is_active LIMIT 1), NULL, '{}'::jsonb
     FROM (SELECT floor(random()*3)::int AS m FROM generate_series(1, ${toAdd})) s`,
  );
  await pool.query("ANALYZE telemetry_events");
}

async function main() {
  await seed();
  const total = await pool.query("SELECT count(*)::int n FROM telemetry_events");
  console.log(`telemetry_events total rows: ${total.rows[0].n}\n`);

  const until = new Date("2026-10-03T00:00:00.000Z").toISOString();
  const since7 = new Date("2026-09-26T00:00:00.000Z").toISOString();
  const since30 = new Date("2026-09-03T00:00:00.000Z").toISOString();
  const anomalyCfg = { minHistory: 6, relThreshold: "0.5", criticalRelThreshold: "1", minAbsoluteUsd: "0.010000" };

  console.log("== telemetry read latency (p50 of 5, local observation only) ==");
  await timeIt("summary 30d (no filter)", () => persistence.aggregateRecentTelemetry(db, { since: since30, until }));
  await timeIt("summary 30d (client filter)", () => persistence.aggregateRecentTelemetry(db, { since: since30, until, clientId: `${PREFIX}3` }));
  await timeIt("timeseries hour 7d", () => persistence.aggregateTelemetryTimeseries(db, { since: since7, until, bucket: "hour" }));
  await timeIt("timeseries day 30d", () => persistence.aggregateTelemetryTimeseries(db, { since: since30, until, bucket: "day" }));
  await timeIt("anomalies hour 7d", () => persistence.detectCostAnomalies(db, { since: since7, until, bucket: "hour" }, anomalyCfg));
  await timeIt("events page limit=15 (no filter)", () => persistence.queryEvents(db, { since: since30, until, limit: 15 }));
  await timeIt("events page limit=15 (client filter)", () => persistence.queryEvents(db, { since: since30, until, clientId: `${PREFIX}3`, limit: 15 }));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    // Always remove seeded rows so the shared database is left clean.
    await pool.query(`DELETE FROM telemetry_events WHERE client_id LIKE $1`, [`${PREFIX}%`]);
    await pool.end();
    await db.destroy();
    console.log("\ncleanup: removed seeded perf-bench rows");
  });
