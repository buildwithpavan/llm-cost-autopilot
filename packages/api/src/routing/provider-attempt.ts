import type { ErrorClass } from "@lca/core";
import type { ExecuteInput, ExecuteResult, ProviderAdapter } from "@lca/providers";

import type { LcaConfig } from "../config.js";

/**
 * Provider error classes that are safe to retry at the provider-attempt layer.
 * Mirrors the transient set used by the core fallback executor
 * (packages/core/src/routing/execute-with-fallback.ts): a failure is retryable
 * only when it is a transient infrastructure fault, never a deterministic
 * client/validation/routing/config error.
 */
const RETRYABLE: ReadonlySet<ErrorClass> = new Set(["timeout", "rate_limit", "upstream_5xx"]);

export function isRetryableErrorClass(errorClass: ErrorClass): boolean {
  return RETRYABLE.has(errorClass);
}

export interface RetryPolicy {
  /** Additional provider attempts after the first (0 = no retries). */
  readonly maxRetries: number;
  /** Base backoff before the first retry, in milliseconds. */
  readonly backoffBaseMs: number;
  /** Upper bound on any single backoff delay, in milliseconds. */
  readonly backoffMaxMs: number;
}

export interface ProviderAttemptPolicy {
  /** Per-attempt execution timeout in milliseconds (applies to one physical call). */
  readonly timeoutMs: number;
  readonly retry: RetryPolicy;
  /**
   * Optional logical-request deadline in milliseconds, bounding TOTAL provider
   * execution (across retries AND fallback) from the start of execution. 0
   * disables it. The caller converts this to an absolute instant shared by all
   * candidates; the per-attempt `timeoutMs` is never replaced, only capped to
   * the remaining budget.
   */
  readonly requestDeadlineMs: number;
}

/**
 * Conservative defaults. Retries are disabled by default (maxRetries = 0) so the
 * reviewed fallback behavior is unchanged; operators opt in via configuration.
 * The timeout matches the historical per-attempt deadline (30 s). The logical
 * request deadline is disabled by default (0).
 */
export const DEFAULT_PROVIDER_ATTEMPT_POLICY: ProviderAttemptPolicy = {
  timeoutMs: 30_000,
  retry: { maxRetries: 0, backoffBaseMs: 100, backoffMaxMs: 2_000 },
  requestDeadlineMs: 0,
};

export function policyFromConfig(config: LcaConfig): ProviderAttemptPolicy {
  return {
    timeoutMs: config.LCA_PROVIDER_TIMEOUT_MS,
    retry: {
      maxRetries: config.LCA_PROVIDER_MAX_RETRIES,
      backoffBaseMs: config.LCA_PROVIDER_RETRY_BACKOFF_MS,
      backoffMaxMs: config.LCA_PROVIDER_RETRY_BACKOFF_MAX_MS,
    },
    requestDeadlineMs: config.LCA_REQUEST_DEADLINE_MS,
  };
}

/**
 * Deterministic bounded exponential backoff. `retryIndex` is 0 for the delay
 * before the first retry, 1 before the second, etc. The result is capped at
 * `backoffMaxMs`; a non-positive base disables sleeping entirely.
 */
export function backoffDelayMs(policy: RetryPolicy, retryIndex: number): number {
  if (policy.backoffBaseMs <= 0) return 0;
  const raw = policy.backoffBaseMs * 2 ** retryIndex;
  return Math.min(raw, policy.backoffMaxMs);
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === "function") t.unref();
  });

export interface RunProviderAttemptArgs {
  readonly adapter: ProviderAdapter;
  readonly input: ExecuteInput;
  /** Index recorded on the returned attempt (the fallback candidate index). */
  readonly attemptIndex: number;
  readonly policy: ProviderAttemptPolicy;
  /** Injectable sleep seam so tests avoid real backoff delays. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Absolute logical-request deadline (epoch ms). Undefined = no deadline. */
  readonly deadlineAt?: number;
  /** Injectable clock for deterministic deadline tests. */
  readonly now?: () => number;
}

/** Per-attempt timeout capped to the remaining logical-request budget (>= 1 ms). */
function effectiveTimeout(timeoutMs: number, deadlineAt: number | undefined, now: () => number): number {
  if (deadlineAt === undefined) return timeoutMs;
  return Math.max(1, Math.min(timeoutMs, Math.floor(deadlineAt - now())));
}

/**
 * Executes a single provider candidate with a bounded per-attempt timeout and a
 * bounded retry policy. Returns exactly one ExecuteResult (the final physical
 * attempt), so the caller's fallback/attempt model is unchanged: retries of a
 * candidate collapse into that candidate's single attempt. Total physical calls
 * are deterministically bounded at `maxRetries + 1`. When a logical-request
 * `deadlineAt` is supplied, no retry starts past the deadline and each attempt's
 * timeout is capped to the remaining budget (the per-attempt timeout is never
 * extended).
 */
export async function runProviderAttempt(args: RunProviderAttemptArgs): Promise<ExecuteResult> {
  const { adapter, input, attemptIndex, policy, deadlineAt } = args;
  const sleep = args.sleep ?? defaultSleep;
  const now = args.now ?? Date.now;

  let result = await executeOnceWithTimeout(
    adapter,
    input,
    attemptIndex,
    effectiveTimeout(policy.timeoutMs, deadlineAt, now),
  );
  for (let retry = 0; retry < policy.retry.maxRetries; retry++) {
    if (result.kind === "success") break;
    if (!isRetryableErrorClass(result.attempt.errorClass)) break;
    if (deadlineAt !== undefined && now() >= deadlineAt) break;
    const delay = backoffDelayMs(policy.retry, retry);
    const capped = deadlineAt === undefined ? delay : Math.min(delay, Math.max(0, deadlineAt - now()));
    if (capped > 0) await sleep(capped);
    if (deadlineAt !== undefined && now() >= deadlineAt) break;
    result = await executeOnceWithTimeout(
      adapter,
      input,
      attemptIndex,
      effectiveTimeout(policy.timeoutMs, deadlineAt, now),
    );
  }
  return result;
}

async function executeOnceWithTimeout(
  adapter: ProviderAdapter,
  input: ExecuteInput,
  attemptIndex: number,
  timeoutMs: number,
): Promise<ExecuteResult> {
  const controller = new AbortController();
  const startedAt = new Date().toISOString();

  // Map a thrown adapter error (contract violation) to a non-retryable failure
  // so an unexpected throw never triggers retries and never leaks a stack trace.
  const resultBranch = adapter.execute(input, controller.signal).then(
    (r) => ({ t: "result" as const, r }),
    () => ({ t: "result" as const, r: synthFailure(adapter.providerId, input, attemptIndex, startedAt, "provider_unavailable") }),
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutBranch = new Promise<{ t: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ t: "timeout" }), timeoutMs);
    if (timer && typeof timer.unref === "function") timer.unref();
  });

  try {
    const raced = await Promise.race([resultBranch, timeoutBranch]);
    if (raced.t === "result") return raced.r;
    // Timeout won the race: cancel the in-flight provider work (where honored)
    // and synthesize a structured timeout failure without waiting for it.
    controller.abort();
    return synthFailure(adapter.providerId, input, attemptIndex, startedAt, "timeout");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function synthFailure(
  providerId: string,
  input: ExecuteInput,
  attemptIndex: number,
  startedAt: string,
  errorClass: ErrorClass,
): ExecuteResult {
  const endedAt = new Date().toISOString();
  return {
    kind: "failure",
    attempt: {
      attemptIndex,
      providerId,
      modelId: input.modelId,
      startedAt,
      endedAt,
      latencyMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
      inputTokens: null,
      outputTokens: null,
      errorClass,
      estimatedCostUsd: "0",
      actualCostUsd: null,
      pricingTableVersionId: input.pricingTable.versionId,
    },
  };
}
