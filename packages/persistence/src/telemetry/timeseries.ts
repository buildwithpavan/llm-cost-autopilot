import { sql } from "kysely";

import type { Db } from "../db/schema.js";

export type TimeseriesBucket = "hour" | "day";

export interface TimeseriesFilters {
  /** Inclusive lower bound (ISO-8601). */
  since: string;
  /** Exclusive upper bound (ISO-8601). */
  until: string;
  bucket: TimeseriesBucket;
  clientId?: string;
  providerId?: string;
  modelId?: string;
}

export interface TimeseriesPoint {
  /** UTC-aligned bucket start, ISO-8601 (`...Z`). */
  bucketStart: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  /** Sum of estimated_cost_usd in the bucket, exact decimal string. */
  estimatedCostUsd: string;
  /** Sum of non-null actual_cost_usd in the bucket, exact decimal string. */
  actualCostUsd: string;
  /** Events in the bucket whose actual_cost_usd IS NULL (pending reconciliation). */
  pendingActualCostCount: number;
  /** Events in the bucket with reconciled = TRUE. */
  reconciledCount: number;
}

interface Row {
  bucket_start: string;
  request_count: string;
  input_tokens: string;
  output_tokens: string;
  estimated_cost_usd: string;
  actual_cost_usd: string;
  pending_actual_cost_count: string;
  reconciled_count: string;
}

/**
 * Aggregate raw telemetry_events into contiguous, zero-filled time buckets
 * entirely in PostgreSQL. Buckets are UTC-aligned (`date_trunc(... AT TIME ZONE
 * 'UTC')`) and deterministically ordered ascending. Monetary values are exact
 * NUMERIC sums cast to text; empty buckets use `"0"`, matching the summary
 * endpoint's convention. Callers MUST bound the window; this function performs
 * no range enforcement and reads raw events only (no rollups).
 */
export async function aggregateTelemetryTimeseries(
  db: Db,
  filters: TimeseriesFilters,
): Promise<TimeseriesPoint[]> {
  const since = new Date(filters.since);
  const until = new Date(filters.until);
  const unit = filters.bucket; // "hour" | "day" — safe, bound as a text parameter
  const stepInterval = filters.bucket === "hour" ? "1 hour" : "1 day";

  const conds = [];
  if (filters.clientId) conds.push(sql`AND client_id = ${filters.clientId}`);
  if (filters.providerId) conds.push(sql`AND effective_provider_id = ${filters.providerId}`);
  if (filters.modelId) conds.push(sql`AND effective_model_id = ${filters.modelId}`);
  const filterSql = conds.length ? sql.join(conds, sql` `) : sql``;

  const result = await sql<Row>`
    WITH bounds AS (
      SELECT
        date_trunc(${unit}, ${since}::timestamptz AT TIME ZONE 'UTC') AS first_bucket,
        date_trunc(${unit}, (${until}::timestamptz - interval '1 microsecond') AT TIME ZONE 'UTC') AS last_bucket
    ),
    buckets AS (
      SELECT generate_series(
        (SELECT first_bucket FROM bounds),
        (SELECT last_bucket FROM bounds),
        ${stepInterval}::interval
      ) AS bucket_start
    ),
    agg AS (
      SELECT
        date_trunc(${unit}, received_at AT TIME ZONE 'UTC') AS bucket_start,
        COUNT(*)::text AS request_count,
        COALESCE(SUM(aggregated_input_tokens), 0)::text  AS input_tokens,
        COALESCE(SUM(aggregated_output_tokens), 0)::text AS output_tokens,
        COALESCE(SUM(estimated_cost_usd), 0)::text       AS estimated_cost_usd,
        COALESCE(SUM(actual_cost_usd), 0)::text          AS actual_cost_usd,
        (COUNT(*) FILTER (WHERE actual_cost_usd IS NULL))::text AS pending_actual_cost_count,
        (COUNT(*) FILTER (WHERE reconciled IS TRUE))::text      AS reconciled_count
      FROM telemetry_events
      WHERE received_at >= ${since} AND received_at < ${until}
        ${filterSql}
      GROUP BY 1
    )
    SELECT
      to_char(b.bucket_start, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS bucket_start,
      COALESCE(a.request_count, '0')             AS request_count,
      COALESCE(a.input_tokens, '0')              AS input_tokens,
      COALESCE(a.output_tokens, '0')             AS output_tokens,
      COALESCE(a.estimated_cost_usd, '0')        AS estimated_cost_usd,
      COALESCE(a.actual_cost_usd, '0')           AS actual_cost_usd,
      COALESCE(a.pending_actual_cost_count, '0') AS pending_actual_cost_count,
      COALESCE(a.reconciled_count, '0')          AS reconciled_count
    FROM buckets b
    LEFT JOIN agg a ON a.bucket_start = b.bucket_start
    ORDER BY b.bucket_start ASC
  `.execute(db);

  return result.rows.map((r) => ({
    bucketStart: r.bucket_start,
    requestCount: Number(r.request_count),
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    estimatedCostUsd: r.estimated_cost_usd,
    actualCostUsd: r.actual_cost_usd,
    pendingActualCostCount: Number(r.pending_actual_cost_count),
    reconciledCount: Number(r.reconciled_count),
  }));
}
