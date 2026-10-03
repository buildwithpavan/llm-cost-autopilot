import type { Metrics } from "./metrics.js";
import { LcaError } from "./errors.js";

/** Bounded terminal-outcome label for lca_requests_total. */
export type RequestOutcome =
  | "success"
  | "client_error"
  | "provider_error"
  | "budget_blocked"
  | "internal_error";

/** Map a completion terminal error (or none) to a bounded outcome label. */
export function outcomeForError(err: unknown): RequestOutcome {
  if (!err) return "success";
  if (err instanceof LcaError) {
    if (err.code === "budget_exceeded") return "budget_blocked";
    return err.httpStatus >= 500 ? "provider_error" : "client_error";
  }
  return "internal_error";
}

export interface CompletionMetricSample {
  /** The error thrown by the handler, or undefined on success. */
  error: unknown;
  /** process.hrtime.bigint() captured at handler entry. */
  startedAt: bigint;
  /** Routing/decision phase ms; null when no routing decision was finalized. */
  routingOverheadMs: number | null;
}

/**
 * Single terminal finalization point for request-level metrics. Emits exactly
 * one request count + one duration observation per completion request, plus a
 * routing-overhead observation only when a decision was finalized. Monotonic
 * timing (hrtime); never affects request behavior.
 */
export function recordCompletionMetrics(metrics: Metrics, sample: CompletionMetricSample): void {
  const durationSec = Number(process.hrtime.bigint() - sample.startedAt) / 1e9;
  metrics.requestsTotal.inc({ outcome: outcomeForError(sample.error) });
  metrics.requestDurationSeconds.observe(durationSec);
  if (sample.routingOverheadMs !== null) {
    metrics.routingOverheadMs.observe(sample.routingOverheadMs);
  }
}
