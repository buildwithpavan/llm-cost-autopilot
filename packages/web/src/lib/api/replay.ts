import type { RoutingDecision } from "../../types/index.js";
import { apiRequest } from "./client.js";

/**
 * Response of GET /v1/telemetry/replay/:eventId.
 * `replayed` is null (with `replayError`) when the deterministic re-score threw.
 */
export interface ReplayResult {
  recorded: RoutingDecision;
  replayed: RoutingDecision | null;
  matches: boolean;
  replayError?: string;
}

/** GET /v1/telemetry/replay/:eventId — read-only, deterministic; never invokes providers. */
export function getReplay(eventId: string, opts: { apiKey?: string; signal?: AbortSignal } = {}): Promise<ReplayResult> {
  const reqOpts: { apiKey?: string; signal?: AbortSignal } = {};
  if (opts.apiKey) reqOpts.apiKey = opts.apiKey;
  if (opts.signal) reqOpts.signal = opts.signal;
  return apiRequest<ReplayResult>(`/v1/telemetry/replay/${encodeURIComponent(eventId)}`, reqOpts);
}
