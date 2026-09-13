import type { TelemetryEvent } from "../../types/index.js";
import { apiRequest } from "./client.js";

export interface ListEventsOptions {
  clientId?: string;
  limit?: number;
  fromDate?: string;
  toDate?: string;
  apiKey?: string;
  signal?: AbortSignal;
}

export interface ListEventsResponse {
  events: TelemetryEvent[];
  cursor?: string;
}

export function listTelemetryEvents(opts: ListEventsOptions = {}): Promise<ListEventsResponse> {
  const q = new URLSearchParams();
  if (opts.clientId) q.set("clientId", opts.clientId);
  if (opts.limit) q.set("limit", String(opts.limit));
  if (opts.fromDate) q.set("fromDate", opts.fromDate);
  if (opts.toDate) q.set("toDate", opts.toDate);
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
