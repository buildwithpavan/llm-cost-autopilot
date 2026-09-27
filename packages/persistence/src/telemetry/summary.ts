import { sql, type SelectQueryBuilder } from "kysely";

import type { Database, Db } from "../db/schema.js";
import type { QueryFilters } from "./query.js";

export interface TelemetrySummaryTotals {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  /** Sum of estimated_cost_usd over all matching events, as a decimal string. */
  estimatedCostUsd: string;
  /** Sum of non-null actual_cost_usd only, as a decimal string. */
  actualCostUsd: string;
  /** Count of matching events whose actual_cost_usd IS NULL (pending reconciliation). */
  pendingActualCostCount: number;
}

export interface TelemetrySummaryProviderGroup extends TelemetrySummaryTotals {
  providerId: string;
}

export interface TelemetrySummaryModelGroup extends TelemetrySummaryTotals {
  providerId: string;
  modelId: string;
}

export interface TelemetrySummary {
  totals: TelemetrySummaryTotals;
  byProvider: TelemetrySummaryProviderGroup[];
  byModel: TelemetrySummaryModelGroup[];
}

type EventsQuery<O> = SelectQueryBuilder<Database, "telemetry_events", O>;

function applyFilters<O>(qb: EventsQuery<O>, filters: QueryFilters): EventsQuery<O> {
  let q = qb;
  if (filters.clientId) q = q.where("client_id", "=", filters.clientId);
  if (filters.providerId) q = q.where("effective_provider_id", "=", filters.providerId);
  if (filters.modelId) q = q.where("effective_model_id", "=", filters.modelId);
  if (filters.since) q = q.where("received_at", ">=", new Date(filters.since));
  if (filters.until) q = q.where("received_at", "<=", new Date(filters.until));
  return q;
}

// Exact aggregate expressions. NUMERIC sums are cast to text so decimal
// precision survives the wire; counts/token sums are safe JS integers.
const AGG = {
  requestCount: sql<string>`COUNT(*)::text`.as("request_count"),
  inputTokens: sql<string>`COALESCE(SUM(aggregated_input_tokens), 0)::text`.as("input_tokens"),
  outputTokens: sql<string>`COALESCE(SUM(aggregated_output_tokens), 0)::text`.as("output_tokens"),
  estimatedCostUsd: sql<string>`COALESCE(SUM(estimated_cost_usd), 0)::text`.as("estimated_cost_usd"),
  actualCostUsd: sql<string>`COALESCE(SUM(actual_cost_usd), 0)::text`.as("actual_cost_usd"),
  pendingActualCostCount: sql<string>`(COUNT(*) FILTER (WHERE actual_cost_usd IS NULL))::text`.as(
    "pending_actual_cost_count",
  ),
} as const;

// Deterministic ordering: estimated cost desc, then identity asc — mirrors the
// frontend cost presenter's group ordering.
const ORDER_BY_COST = sql`COALESCE(SUM(estimated_cost_usd), 0)`;

interface AggRow {
  request_count: string;
  input_tokens: string;
  output_tokens: string;
  estimated_cost_usd: string;
  actual_cost_usd: string;
  pending_actual_cost_count: string;
}

function toTotals(r: AggRow): TelemetrySummaryTotals {
  return {
    requestCount: Number(r.request_count),
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    estimatedCostUsd: r.estimated_cost_usd,
    actualCostUsd: r.actual_cost_usd,
    pendingActualCostCount: Number(r.pending_actual_cost_count),
  };
}

/**
 * Aggregate recent telemetry_events into overall totals plus per-provider and
 * per-model breakdowns, entirely in PostgreSQL. Callers must bound the window
 * via `since`/`until`; this function does not enforce a maximum range.
 */
export async function aggregateRecentTelemetry(
  db: Db,
  filters: QueryFilters = {},
): Promise<TelemetrySummary> {
  const totalsRow = (await applyFilters(db.selectFrom("telemetry_events"), filters)
    .select([
      AGG.requestCount,
      AGG.inputTokens,
      AGG.outputTokens,
      AGG.estimatedCostUsd,
      AGG.actualCostUsd,
      AGG.pendingActualCostCount,
    ])
    .executeTakeFirstOrThrow()) as unknown as AggRow;

  const providerRows = (await applyFilters(db.selectFrom("telemetry_events"), filters)
    .select([
      "effective_provider_id as provider_id",
      AGG.requestCount,
      AGG.inputTokens,
      AGG.outputTokens,
      AGG.estimatedCostUsd,
      AGG.actualCostUsd,
      AGG.pendingActualCostCount,
    ])
    .groupBy("effective_provider_id")
    .orderBy(ORDER_BY_COST, "desc")
    .orderBy("effective_provider_id", "asc")
    .execute()) as unknown as Array<AggRow & { provider_id: string }>;

  const modelRows = (await applyFilters(db.selectFrom("telemetry_events"), filters)
    .select([
      "effective_provider_id as provider_id",
      "effective_model_id as model_id",
      AGG.requestCount,
      AGG.inputTokens,
      AGG.outputTokens,
      AGG.estimatedCostUsd,
      AGG.actualCostUsd,
      AGG.pendingActualCostCount,
    ])
    .groupBy(["effective_provider_id", "effective_model_id"])
    .orderBy(ORDER_BY_COST, "desc")
    .orderBy("effective_provider_id", "asc")
    .orderBy("effective_model_id", "asc")
    .execute()) as unknown as Array<AggRow & { provider_id: string; model_id: string }>;

  return {
    totals: toTotals(totalsRow),
    byProvider: providerRows.map((r) => ({ providerId: r.provider_id, ...toTotals(r) })),
    byModel: modelRows.map((r) => ({
      providerId: r.provider_id,
      modelId: r.model_id,
      ...toTotals(r),
    })),
  };
}
