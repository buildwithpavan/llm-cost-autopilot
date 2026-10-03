import { sql } from "kysely";

import type { Db } from "../db/schema.js";
import type { TimeseriesBucket } from "./timeseries.js";

/**
 * Deterministic anomaly thresholds. Monetary values are exact decimal strings;
 * ratios are small exact decimals. None of these come from request input.
 */
export interface AnomalyConfig {
  /** Minimum active preceding buckets required before a target is evaluated. */
  minHistory: number;
  /** Warning trigger: relative deviation above baseline, as a fraction (e.g. "0.5"). */
  relThreshold: string;
  /** Critical trigger: relative deviation above baseline, as a fraction (e.g. "1.0"). */
  criticalRelThreshold: string;
  /** Absolute floor on a bucket's estimated cost, decimal USD string (e.g. "0.010000"). */
  minAbsoluteUsd: string;
}

export interface AnomalyFilters {
  /** Inclusive lower bound of the returned window (ISO-8601). */
  since: string;
  /** Exclusive upper bound of the returned window (ISO-8601). */
  until: string;
  bucket: TimeseriesBucket;
  clientId?: string;
  providerId?: string;
  modelId?: string;
  /** Completeness reference; the bucket containing `now` is excluded (incomplete). Defaults to `until`. */
  now?: string;
}

export type AnomalySeverity = "warning" | "critical";

export interface CostAnomaly {
  bucketStart: string;
  estimatedCostUsd: string;
  baselineEstimatedCostUsd: string;
  deviationUsd: string;
  deviationPercent: string;
  historicalBucketCount: number;
  severity: AnomalySeverity;
}

/**
 * Internal baseline lookback: the number of immediately-preceding contiguous
 * buckets considered when forming a target's baseline. Active buckets among
 * these form the mean; the query extends its internal lower bound by this many
 * buckets so targets near `since` still have context (public response stays
 * within [since, until)).
 */
const BASELINE_LOOKBACK: Record<TimeseriesBucket, number> = { hour: 24, day: 14 };
const BUCKET_MS: Record<TimeseriesBucket, number> = { hour: 3_600_000, day: 86_400_000 };

interface Row {
  bucket_start: string;
  estimated_cost_usd: string;
  baseline_estimated_cost_usd: string;
  deviation_usd: string;
  deviation_percent: string;
  historical_bucket_count: number;
  severity: AnomalySeverity;
}

/**
 * Deterministic cost-anomaly detection over raw telemetry_events, computed
 * entirely in PostgreSQL with exact NUMERIC arithmetic (no floating point).
 *
 * For each COMPLETED bucket in [since, until) (the bucket containing `now` is
 * excluded as incomplete) the baseline is the mean estimated cost of the active
 * buckets among the preceding `BASELINE_LOOKBACK` buckets, excluding the target
 * itself. A bucket is flagged only when ALL hold:
 *   - at least `minHistory` active preceding buckets exist (else not evaluated);
 *   - baseline > 0;
 *   - estimated cost ≥ `minAbsoluteUsd` (absolute floor, filters tiny spikes);
 *   - estimated − baseline ≥ baseline × `relThreshold` (relative deviation).
 * Severity is `critical` when the deviation ≥ baseline × `criticalRelThreshold`,
 * otherwise `warning`. Results are ordered by bucket time (never ranked).
 */
export async function detectCostAnomalies(
  db: Db,
  filters: AnomalyFilters,
  config: AnomalyConfig,
): Promise<CostAnomaly[]> {
  const since = new Date(filters.since);
  const until = new Date(filters.until);
  const now = filters.now ? new Date(filters.now) : until;
  const unit = filters.bucket;
  const stepInterval = filters.bucket === "hour" ? "1 hour" : "1 day";
  const lookback = BASELINE_LOOKBACK[filters.bucket];
  const extSince = new Date(since.getTime() - lookback * BUCKET_MS[filters.bucket]);

  const conds = [];
  if (filters.clientId) conds.push(sql`AND client_id = ${filters.clientId}`);
  if (filters.providerId) conds.push(sql`AND effective_provider_id = ${filters.providerId}`);
  if (filters.modelId) conds.push(sql`AND effective_model_id = ${filters.modelId}`);
  const filterSql = conds.length ? sql.join(conds, sql` `) : sql``;

  const result = await sql<Row>`
    WITH buckets AS (
      SELECT generate_series(
        date_trunc(${unit}, ${extSince}::timestamptz AT TIME ZONE 'UTC'),
        date_trunc(${unit}, (${until}::timestamptz - interval '1 microsecond') AT TIME ZONE 'UTC'),
        ${stepInterval}::interval
      ) AS bucket_start
    ),
    agg AS (
      SELECT
        date_trunc(${unit}, received_at AT TIME ZONE 'UTC') AS bucket_start,
        COUNT(*) AS request_count,
        COALESCE(SUM(estimated_cost_usd), 0) AS est_sum
      FROM telemetry_events
      WHERE received_at >= ${extSince} AND received_at < ${until}
        ${filterSql}
      GROUP BY 1
    ),
    series AS (
      SELECT
        b.bucket_start,
        COALESCE(a.request_count, 0) AS request_count,
        COALESCE(a.est_sum, 0)::numeric AS estimated
      FROM buckets b
      LEFT JOIN agg a ON a.bucket_start = b.bucket_start
    ),
    windowed AS (
      SELECT
        bucket_start,
        request_count,
        estimated,
        COUNT(*) FILTER (WHERE request_count > 0)
          OVER (ORDER BY bucket_start ROWS BETWEEN ${sql.lit(lookback)} PRECEDING AND 1 PRECEDING) AS hist_count,
        SUM(estimated) FILTER (WHERE request_count > 0)
          OVER (ORDER BY bucket_start ROWS BETWEEN ${sql.lit(lookback)} PRECEDING AND 1 PRECEDING) AS hist_sum
      FROM series
    ),
    evaluated AS (
      SELECT
        bucket_start,
        request_count,
        estimated,
        hist_count,
        CASE WHEN hist_count >= ${config.minHistory} THEN hist_sum / hist_count ELSE NULL END AS baseline
      FROM windowed
      WHERE bucket_start >= date_trunc(${unit}, ${since}::timestamptz AT TIME ZONE 'UTC')
        AND bucket_start < date_trunc(${unit}, ${now}::timestamptz AT TIME ZONE 'UTC')
    )
    SELECT
      to_char(bucket_start, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS bucket_start,
      round(estimated, 6)::text AS estimated_cost_usd,
      round(baseline, 6)::text AS baseline_estimated_cost_usd,
      round(estimated - baseline, 6)::text AS deviation_usd,
      round((estimated - baseline) / baseline * 100, 2)::text AS deviation_percent,
      hist_count::int AS historical_bucket_count,
      CASE WHEN (estimated - baseline) >= baseline * ${config.criticalRelThreshold}::numeric
           THEN 'critical' ELSE 'warning' END AS severity
    FROM evaluated
    WHERE baseline IS NOT NULL
      AND baseline > 0
      AND request_count > 0
      AND estimated >= ${config.minAbsoluteUsd}::numeric
      AND (estimated - baseline) >= baseline * ${config.relThreshold}::numeric
    ORDER BY bucket_start ASC
  `.execute(db);

  return result.rows.map((r) => ({
    bucketStart: r.bucket_start,
    estimatedCostUsd: r.estimated_cost_usd,
    baselineEstimatedCostUsd: r.baseline_estimated_cost_usd,
    deviationUsd: r.deviation_usd,
    deviationPercent: r.deviation_percent,
    historicalBucketCount: Number(r.historical_bucket_count),
    severity: r.severity,
  }));
}
