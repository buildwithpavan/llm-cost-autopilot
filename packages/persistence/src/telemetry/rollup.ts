import { sql } from "kysely";

import type { Db } from "../db/schema.js";

const ROLLUP_LOCK_ID = 947_105_632; // deterministic advisory lock id

async function acquireLock(db: Db): Promise<boolean> {
  const result = await sql<{ pg_try_advisory_lock: boolean }>`
    SELECT pg_try_advisory_lock(${ROLLUP_LOCK_ID}) AS pg_try_advisory_lock
  `.execute(db);
  return Boolean(result.rows[0]?.pg_try_advisory_lock);
}

async function releaseLock(db: Db): Promise<void> {
  await sql`SELECT pg_advisory_unlock(${ROLLUP_LOCK_ID})`.execute(db);
}

export interface AggregateResult {
  rollupsWritten: number;
  eventsConsidered: number;
}

/**
 * Aggregate all telemetry_events with received_at < cutoff into telemetry_rollups
 * keyed by (day, provider, model). Idempotent: uses INSERT ... ON CONFLICT DO UPDATE.
 */
export async function aggregateExpiringEvents(
  db: Db,
  cutoffIso: string,
): Promise<AggregateResult> {
  const locked = await acquireLock(db);
  if (!locked) return { rollupsWritten: 0, eventsConsidered: 0 };
  try {
    // Two-step aggregation: base metrics + JSON breakdowns joined by
    // (day, provider, model). Avoids correlated subqueries in the group.
    const rows = await sql<{
      rollup_date: string;
      provider_id: string;
      model_id: string;
      request_count: string;
      input_tokens_sum: string;
      output_tokens_sum: string;
      estimated_cost_sum_usd: string;
      actual_cost_sum_usd: string;
      latency_p50: string;
      latency_p95: string;
      latency_p99: string;
      reconciled_true: string;
      reconciled_total: string;
      terminal_error_counts: unknown;
      decision_source_counts: unknown;
    }>`
      WITH base AS (
        SELECT
          date_trunc('day', received_at)::date AS rollup_date,
          effective_provider_id AS provider_id,
          effective_model_id    AS model_id,
          COUNT(*)::text AS request_count,
          SUM(aggregated_input_tokens)::text  AS input_tokens_sum,
          SUM(aggregated_output_tokens)::text AS output_tokens_sum,
          SUM(estimated_cost_usd)::text       AS estimated_cost_sum_usd,
          SUM(COALESCE(actual_cost_usd, 0))::text AS actual_cost_sum_usd,
          percentile_disc(0.5) WITHIN GROUP (ORDER BY total_latency_ms)::text  AS latency_p50,
          percentile_disc(0.95) WITHIN GROUP (ORDER BY total_latency_ms)::text AS latency_p95,
          percentile_disc(0.99) WITHIN GROUP (ORDER BY total_latency_ms)::text AS latency_p99,
          SUM(CASE WHEN reconciled = TRUE THEN 1 ELSE 0 END)::text AS reconciled_true,
          SUM(CASE WHEN reconciled IS NOT NULL THEN 1 ELSE 0 END)::text AS reconciled_total
        FROM telemetry_events
        WHERE received_at < ${new Date(cutoffIso)}
        GROUP BY 1, 2, 3
      ),
      err AS (
        SELECT
          date_trunc('day', received_at)::date AS rollup_date,
          effective_provider_id AS provider_id,
          effective_model_id    AS model_id,
          jsonb_object_agg(terminal_error_class, cnt) AS terminal_error_counts
        FROM (
          SELECT received_at, effective_provider_id, effective_model_id,
                 terminal_error_class, COUNT(*) AS cnt
          FROM telemetry_events
          WHERE received_at < ${new Date(cutoffIso)}
          GROUP BY 1, 2, 3, 4
        ) t
        GROUP BY 1, 2, 3
      ),
      dsrc AS (
        SELECT
          date_trunc('day', received_at)::date AS rollup_date,
          effective_provider_id AS provider_id,
          effective_model_id    AS model_id,
          jsonb_object_agg(decision_source, cnt) AS decision_source_counts
        FROM (
          SELECT received_at, effective_provider_id, effective_model_id,
                 decision_source, COUNT(*) AS cnt
          FROM telemetry_events
          WHERE received_at < ${new Date(cutoffIso)}
          GROUP BY 1, 2, 3, 4
        ) t
        GROUP BY 1, 2, 3
      )
      SELECT
        base.rollup_date::text AS rollup_date,
        base.provider_id,
        base.model_id,
        base.request_count,
        base.input_tokens_sum,
        base.output_tokens_sum,
        base.estimated_cost_sum_usd,
        base.actual_cost_sum_usd,
        base.latency_p50,
        base.latency_p95,
        base.latency_p99,
        base.reconciled_true,
        base.reconciled_total,
        COALESCE(err.terminal_error_counts, '{}'::jsonb)  AS terminal_error_counts,
        COALESCE(dsrc.decision_source_counts, '{}'::jsonb) AS decision_source_counts
      FROM base
      LEFT JOIN err  USING (rollup_date, provider_id, model_id)
      LEFT JOIN dsrc USING (rollup_date, provider_id, model_id)
    `.execute(db);

    let rollupsWritten = 0;
    let eventsConsidered = 0;
    for (const r of rows.rows) {
      const reconciledTotal = Number(r.reconciled_total);
      const reconciledTrue = Number(r.reconciled_true);
      const rate = reconciledTotal === 0 ? 0 : reconciledTrue / reconciledTotal;
      eventsConsidered += Number(r.request_count);
      await db
        .insertInto("telemetry_rollups")
        .values({
          rollup_date: r.rollup_date,
          provider_id: r.provider_id,
          model_id: r.model_id,
          request_count: Number(r.request_count),
          terminal_error_counts: JSON.stringify(r.terminal_error_counts ?? {}),
          input_tokens_sum: r.input_tokens_sum,
          output_tokens_sum: r.output_tokens_sum,
          estimated_cost_sum_usd: r.estimated_cost_sum_usd,
          actual_cost_sum_usd: r.actual_cost_sum_usd,
          latency_p50_ms: Number(r.latency_p50),
          latency_p95_ms: Number(r.latency_p95),
          latency_p99_ms: Number(r.latency_p99),
          reconciled_rate: rate.toFixed(4),
          decision_source_counts: JSON.stringify(r.decision_source_counts ?? {}),
        })
        .onConflict((oc) =>
          oc
            .columns(["rollup_date", "provider_id", "model_id"])
            .doUpdateSet({
              request_count: Number(r.request_count),
              terminal_error_counts: JSON.stringify(r.terminal_error_counts ?? {}),
              input_tokens_sum: r.input_tokens_sum,
              output_tokens_sum: r.output_tokens_sum,
              estimated_cost_sum_usd: r.estimated_cost_sum_usd,
              actual_cost_sum_usd: r.actual_cost_sum_usd,
              latency_p50_ms: Number(r.latency_p50),
              latency_p95_ms: Number(r.latency_p95),
              latency_p99_ms: Number(r.latency_p99),
              reconciled_rate: rate.toFixed(4),
              decision_source_counts: JSON.stringify(r.decision_source_counts ?? {}),
              aggregated_at: new Date(),
            }),
        )
        .execute();
      rollupsWritten++;
    }
    return { rollupsWritten, eventsConsidered };
  } finally {
    await releaseLock(db);
  }
}

/** Delete telemetry_events strictly older than cutoff. Returns the row count. */
export async function deleteExpiredEvents(db: Db, cutoffIso: string): Promise<number> {
  const result = await db
    .deleteFrom("telemetry_events")
    .where("received_at", "<", new Date(cutoffIso))
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}

/** Delete rollups strictly older than the given date (YYYY-MM-DD). Returns row count. */
export async function deleteExpiredRollups(db: Db, cutoffDate: string): Promise<number> {
  const result = await db
    .deleteFrom("telemetry_rollups")
    .where("rollup_date", "<", new Date(cutoffDate))
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}
