import { sql } from "kysely";

import type { TelemetryEvent, Attempt } from "@lca/core";

import type { Db } from "../db/schema.js";

export interface QueryFilters {
  clientId?: string;
  providerId?: string;
  modelId?: string;
  since?: string;
  until?: string;
}

export interface QueryOptions extends QueryFilters {
  limit?: number;
  cursor?: string | null;
}

export interface QueryPage {
  events: TelemetryEvent[];
  nextCursor: string | null;
}

interface CursorPayload {
  receivedAt: string;
  eventId: string;
}

function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
}

function decodeCursor(s: string): CursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    if (typeof parsed.receivedAt === "string" && typeof parsed.eventId === "string") {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

type Row = {
  event_id: string;
  received_at: Date;
  client_id: string;
  decision_source: string;
  shadowed_source: string | null;
  effective_provider_id: string;
  effective_model_id: string;
  attempts: unknown;
  aggregated_input_tokens: number;
  aggregated_output_tokens: number;
  total_latency_ms: number;
  terminal_error_class: string;
  estimated_cost_usd: string;
  actual_cost_usd: string | null;
  pricing_table_version_id: string;
  reconciled: boolean | null;
  routing_rationale: unknown;
};

function rowToEvent(r: Row): TelemetryEvent {
  return {
    eventId: r.event_id,
    receivedAt: r.received_at.toISOString(),
    clientId: r.client_id,
    decisionSource: r.decision_source as TelemetryEvent["decisionSource"],
    shadowedSource: r.shadowed_source as TelemetryEvent["shadowedSource"],
    effectiveProviderId: r.effective_provider_id,
    effectiveModelId: r.effective_model_id,
    attempts: r.attempts as Attempt[],
    aggregatedInputTokens: r.aggregated_input_tokens,
    aggregatedOutputTokens: r.aggregated_output_tokens,
    totalLatencyMs: r.total_latency_ms,
    terminalErrorClass: r.terminal_error_class as TelemetryEvent["terminalErrorClass"],
    estimatedCostUsd: r.estimated_cost_usd,
    actualCostUsd: r.actual_cost_usd,
    pricingTableVersionId: r.pricing_table_version_id,
    reconciled: r.reconciled,
    routingRationale: r.routing_rationale as TelemetryEvent["routingRationale"],
  };
}

export async function queryEvents(db: Db, opts: QueryOptions = {}): Promise<QueryPage> {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
  let q = db.selectFrom("telemetry_events").selectAll();
  if (opts.clientId) q = q.where("client_id", "=", opts.clientId);
  if (opts.providerId) q = q.where("effective_provider_id", "=", opts.providerId);
  if (opts.modelId) q = q.where("effective_model_id", "=", opts.modelId);
  if (opts.since) q = q.where("received_at", ">=", new Date(opts.since));
  if (opts.until) q = q.where("received_at", "<=", new Date(opts.until));

  if (opts.cursor) {
    const c = decodeCursor(opts.cursor);
    if (c) {
      const cDate = new Date(c.receivedAt);
      q = q.where((eb) =>
        eb.or([
          eb("received_at", "<", cDate),
          eb.and([
            eb("received_at", "=", cDate),
            eb("event_id", "<", c.eventId),
          ]),
        ]),
      );
    }
  }

  const rows = await q
    .orderBy("received_at", "desc")
    .orderBy("event_id", "desc")
    .limit(limit + 1)
    .execute() as unknown as Row[];

  const trimmed = rows.slice(0, limit);
  const events = trimmed.map(rowToEvent);
  const lastRow = trimmed[trimmed.length - 1];
  const nextCursor =
    rows.length > limit && lastRow
      ? encodeCursor({
          receivedAt: lastRow.received_at.toISOString(),
          eventId: lastRow.event_id,
        })
      : null;
  return { events, nextCursor };
}

export async function getEventById(db: Db, eventId: string): Promise<TelemetryEvent | null> {
  const row = (await db
    .selectFrom("telemetry_events")
    .selectAll()
    .where("event_id", "=", eventId)
    .executeTakeFirst()) as Row | undefined;
  return row ? rowToEvent(row) : null;
}

export interface RollupFilters {
  providerId?: string;
  modelId?: string;
  fromDate?: string;
  toDate?: string;
}

export async function queryRollups(db: Db, filters: RollupFilters = {}): Promise<unknown[]> {
  let q = db.selectFrom("telemetry_rollups").selectAll();
  if (filters.providerId) q = q.where("provider_id", "=", filters.providerId);
  if (filters.modelId) q = q.where("model_id", "=", filters.modelId);
  if (filters.fromDate) q = q.where("rollup_date", ">=", new Date(filters.fromDate));
  if (filters.toDate) q = q.where("rollup_date", "<=", new Date(filters.toDate));
  const rows = await q.orderBy("rollup_date", "desc").execute();
  return rows.map((r) => ({
    rollupDate:
      typeof r.rollup_date === "string"
        ? r.rollup_date
        : r.rollup_date.toISOString().slice(0, 10),
    providerId: r.provider_id,
    modelId: r.model_id,
    requestCount: r.request_count,
    terminalErrorCounts: r.terminal_error_counts,
    inputTokensSum: Number(r.input_tokens_sum),
    outputTokensSum: Number(r.output_tokens_sum),
    estimatedCostSumUsd: r.estimated_cost_sum_usd,
    actualCostSumUsd: r.actual_cost_sum_usd,
    latencyPercentilesMs: {
      p50: r.latency_p50_ms,
      p95: r.latency_p95_ms,
      p99: r.latency_p99_ms,
    },
    reconciledRate: Number(r.reconciled_rate),
    decisionSourceCounts: r.decision_source_counts,
    aggregatedAt: r.aggregated_at.toISOString(),
  }));
}

export async function readReconciliationWindow(
  db: Db,
  opts: { windowMinutes?: number; windowRows?: number } = {},
): Promise<{ sampleCount: number; reconciledCount: number; rate: number }> {
  const windowMinutes = opts.windowMinutes ?? 60;
  const windowRows = opts.windowRows ?? 1_000;
  const since = new Date(Date.now() - windowMinutes * 60_000);
  const rows = await db
    .selectFrom("telemetry_events")
    .select(["reconciled"])
    .where("reconciled", "is not", null)
    .where("received_at", ">=", since)
    .orderBy("received_at", "desc")
    .limit(windowRows)
    .execute();
  const sampleCount = rows.length;
  const reconciledCount = rows.filter((r) => r.reconciled === true).length;
  const rate = sampleCount === 0 ? 1 : reconciledCount / sampleCount;
  return { sampleCount, reconciledCount, rate };
}

// Suppress unused sql import when readReconciliationWindow doesn't need it.
export const _sqlRef = sql;
