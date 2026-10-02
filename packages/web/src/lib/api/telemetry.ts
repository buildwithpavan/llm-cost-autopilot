import type { TelemetryEvent } from "../../types/index.js";
import { apiRequest } from "./client.js";

export interface ListEventsOptions {
  clientId?: string;
  providerId?: string;
  modelId?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
  apiKey?: string;
  signal?: AbortSignal;
}

export interface ListEventsResponse {
  events: TelemetryEvent[];
  nextCursor?: string | null;
}

// Mirrors GET /v1/telemetry/events (clientId/providerId/modelId/since/until/limit/cursor).
export function listTelemetryEvents(opts: ListEventsOptions = {}): Promise<ListEventsResponse> {
  const q = new URLSearchParams();
  if (opts.clientId) q.set("clientId", opts.clientId);
  if (opts.providerId) q.set("providerId", opts.providerId);
  if (opts.modelId) q.set("modelId", opts.modelId);
  if (opts.since) q.set("since", opts.since);
  if (opts.until) q.set("until", opts.until);
  if (opts.limit) q.set("limit", String(opts.limit));
  if (opts.cursor) q.set("cursor", opts.cursor);
  const search = q.toString();
  const path = `/v1/telemetry/events${search ? `?${search}` : ""}`;
  const reqOpts: {
    apiKey?: string;
    signal?: AbortSignal;
  } = {};
  if (opts.apiKey) reqOpts.apiKey = opts.apiKey;
  if (opts.signal) reqOpts.signal = opts.signal;
  return apiRequest<ListEventsResponse>(path, reqOpts);
}

/** Aggregate metrics shared by the summary totals and each breakdown row. Costs are decimal strings. */
export interface TelemetrySummaryMetrics {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: string;
  actualCostUsd: string;
  pendingActualCostCount: number;
}

export interface TelemetrySummaryProvider extends TelemetrySummaryMetrics {
  providerId: string;
}

export interface TelemetrySummaryModel extends TelemetrySummaryMetrics {
  providerId: string;
  modelId: string;
}

export interface TelemetrySummaryResponse {
  window: { since: string; until: string };
  totals: TelemetrySummaryMetrics;
  byProvider: TelemetrySummaryProvider[];
  byModel: TelemetrySummaryModel[];
}

export interface SummaryOptions {
  since?: string;
  until?: string;
  clientId?: string;
  providerId?: string;
  modelId?: string;
  apiKey?: string;
  signal?: AbortSignal;
}

// Mirrors GET /v1/telemetry/summary (since/until/clientId/providerId/modelId).
export function getTelemetrySummary(opts: SummaryOptions = {}): Promise<TelemetrySummaryResponse> {
  const q = new URLSearchParams();
  if (opts.since) q.set("since", opts.since);
  if (opts.until) q.set("until", opts.until);
  if (opts.clientId) q.set("clientId", opts.clientId);
  if (opts.providerId) q.set("providerId", opts.providerId);
  if (opts.modelId) q.set("modelId", opts.modelId);
  const search = q.toString();
  const path = `/v1/telemetry/summary${search ? `?${search}` : ""}`;
  const reqOpts: { apiKey?: string; signal?: AbortSignal } = {};
  if (opts.apiKey) reqOpts.apiKey = opts.apiKey;
  if (opts.signal) reqOpts.signal = opts.signal;
  return apiRequest<TelemetrySummaryResponse>(path, reqOpts);
}
