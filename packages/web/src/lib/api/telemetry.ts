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
