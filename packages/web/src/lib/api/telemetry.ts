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

export type TimeseriesBucket = "hour" | "day";

/** One contiguous, zero-filled time bucket. Monetary fields are exact decimal strings. */
export interface TimeseriesBucketPoint {
  bucketStart: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: string;
  actualCostUsd: string;
  pendingActualCostCount: number;
  reconciledCount: number;
}

export interface TimeseriesResponse {
  window: { since: string; until: string };
  bucket: TimeseriesBucket;
  buckets: TimeseriesBucketPoint[];
}

export interface TimeseriesOptions {
  since?: string;
  until?: string;
  bucket?: TimeseriesBucket;
  clientId?: string;
  providerId?: string;
  modelId?: string;
  apiKey?: string;
  signal?: AbortSignal;
}

// Mirrors GET /v1/telemetry/timeseries (since/until/bucket/clientId/providerId/modelId).
// Monetary values are kept as decimal strings verbatim — never parsed to Number here.
export function getTelemetryTimeseries(opts: TimeseriesOptions = {}): Promise<TimeseriesResponse> {
  const q = new URLSearchParams();
  if (opts.since) q.set("since", opts.since);
  if (opts.until) q.set("until", opts.until);
  if (opts.bucket) q.set("bucket", opts.bucket);
  if (opts.clientId) q.set("clientId", opts.clientId);
  if (opts.providerId) q.set("providerId", opts.providerId);
  if (opts.modelId) q.set("modelId", opts.modelId);
  const search = q.toString();
  const path = `/v1/telemetry/timeseries${search ? `?${search}` : ""}`;
  const reqOpts: { apiKey?: string; signal?: AbortSignal } = {};
  if (opts.apiKey) reqOpts.apiKey = opts.apiKey;
  if (opts.signal) reqOpts.signal = opts.signal;
  return apiRequest<TimeseriesResponse>(path, reqOpts);
}

export type AnomalySeverity = "warning" | "critical";

/** One deterministic cost anomaly. All monetary fields are exact decimal strings. */
export interface AnomalyRecord {
  bucketStart: string;
  estimatedCostUsd: string;
  baselineEstimatedCostUsd: string;
  deviationUsd: string;
  /** Percentage deviation above baseline, decimal string (e.g. "60.00"). */
  deviationPercent: string;
  historicalBucketCount: number;
  severity: AnomalySeverity;
}

export interface AnomalyThresholds {
  minHistory: number;
  relThreshold: string;
  criticalRelThreshold: string;
  minAbsoluteUsd: string;
}

export interface AnomaliesResponse {
  window: { since: string; until: string };
  bucket: TimeseriesBucket;
  thresholds: AnomalyThresholds;
  anomalies: AnomalyRecord[];
}

export interface AnomaliesOptions {
  since?: string;
  until?: string;
  bucket?: TimeseriesBucket;
  clientId?: string;
  providerId?: string;
  modelId?: string;
  apiKey?: string;
  signal?: AbortSignal;
}

// Mirrors GET /v1/telemetry/anomalies (since/until/bucket/clientId/providerId/modelId).
// Monetary values stay as exact decimal strings — never converted to Number here.
export function getTelemetryAnomalies(opts: AnomaliesOptions = {}): Promise<AnomaliesResponse> {
  const q = new URLSearchParams();
  if (opts.since) q.set("since", opts.since);
  if (opts.until) q.set("until", opts.until);
  if (opts.bucket) q.set("bucket", opts.bucket);
  if (opts.clientId) q.set("clientId", opts.clientId);
  if (opts.providerId) q.set("providerId", opts.providerId);
  if (opts.modelId) q.set("modelId", opts.modelId);
  const search = q.toString();
  const path = `/v1/telemetry/anomalies${search ? `?${search}` : ""}`;
  const reqOpts: { apiKey?: string; signal?: AbortSignal } = {};
  if (opts.apiKey) reqOpts.apiKey = opts.apiKey;
  if (opts.signal) reqOpts.signal = opts.signal;
  return apiRequest<AnomaliesResponse>(path, reqOpts);
}

