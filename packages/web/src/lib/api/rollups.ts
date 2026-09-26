import type { TelemetryRollup } from "../../types/index.js";
import { apiRequest } from "./client.js";

export interface ListRollupsOptions {
  providerId?: string;
  modelId?: string;
  /** YYYY-MM-DD inclusive lower bound. */
  fromDate?: string;
  /** YYYY-MM-DD inclusive upper bound. */
  toDate?: string;
  apiKey?: string;
  signal?: AbortSignal;
}

/**
 * Mirrors GET /v1/telemetry/rollups (daily per-provider/model aggregates).
 * Note: rollups only cover data older than the full-fidelity retention window,
 * so this is empty for recent activity and is not a required Cost Dashboard source.
 */
export function listTelemetryRollups(opts: ListRollupsOptions = {}): Promise<TelemetryRollup[]> {
  const q = new URLSearchParams();
  if (opts.providerId) q.set("providerId", opts.providerId);
  if (opts.modelId) q.set("modelId", opts.modelId);
  if (opts.fromDate) q.set("fromDate", opts.fromDate);
  if (opts.toDate) q.set("toDate", opts.toDate);
  const search = q.toString();
  const path = `/v1/telemetry/rollups${search ? `?${search}` : ""}`;
  const reqOpts: { apiKey?: string; signal?: AbortSignal } = {};
  if (opts.apiKey) reqOpts.apiKey = opts.apiKey;
  if (opts.signal) reqOpts.signal = opts.signal;
  return apiRequest<TelemetryRollup[]>(path, reqOpts);
}
