import { describe, expect, it, vi } from "vitest";

import type { Attempt, NormalizedRequest, PricingTable } from "@lca/core";
import type { ExecuteInput, ExecuteResult, ProviderAdapter } from "@lca/providers";

import {
  backoffDelayMs,
  isRetryableErrorClass,
  runProviderAttempt,
  type ProviderAttemptPolicy,
} from "../../src/routing/provider-attempt.js";

const PRICING: PricingTable = {
  versionId: "pt-test",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  entries: [],
};

const REQUEST = {
  requestId: "r1",
  clientId: "c1",
  receivedAt: "2026-01-01T00:00:00.000Z",
  messages: [{ role: "user" as const, content: "hi" }],
  requirements: { requiredCapabilities: [], maxLatencyMs: null, maxCostUsd: null, minQualityTier: null },
  override: null,
  estimatedInputTokens: 4,
} as unknown as NormalizedRequest;

const INPUT: ExecuteInput = { request: REQUEST, modelId: "m1", pricingTable: PRICING, deadlineAt: "2026-01-01T00:00:30.000Z" };

function attempt(errorClass: Attempt["errorClass"]): Attempt {
  return {
    attemptIndex: 0,
    providerId: "p1",
    modelId: "m1",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:00.000Z",
    latencyMs: 0,
    inputTokens: errorClass === "none" ? 4 : null,
    outputTokens: errorClass === "none" ? 2 : null,
    errorClass,
    estimatedCostUsd: "0",
    actualCostUsd: null,
    pricingTableVersionId: PRICING.versionId,
  };
}

function okResult(): ExecuteResult {
  return { kind: "success", content: "ok", finishReason: "stop", attempt: attempt("none") };
}
function failResult(errorClass: Attempt["errorClass"]): ExecuteResult {
  return { kind: "failure", attempt: attempt(errorClass) };
}

/** Builds a fake adapter that returns the queued results in order. */
function sequenceAdapter(results: ExecuteResult[]): { adapter: ProviderAdapter; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async () => results.shift() ?? okResult());
  const adapter: ProviderAdapter = {
    providerId: "p1",
    listModels: () => [],
    probeHealth: async () => ({ providerId: "p1", healthy: true, lastProbedAt: "", consecutiveFailures: 0 }),
    execute,
  };
  return { adapter, execute };
}

const NO_RETRY: ProviderAttemptPolicy = { timeoutMs: 1_000, retry: { maxRetries: 0, backoffBaseMs: 0, backoffMaxMs: 0 }, requestDeadlineMs: 0 };
function retryPolicy(maxRetries: number): ProviderAttemptPolicy {
  return { timeoutMs: 1_000, retry: { maxRetries, backoffBaseMs: 10, backoffMaxMs: 100 }, requestDeadlineMs: 0 };
}
const noSleep = async () => {};

describe("isRetryableErrorClass", () => {
  it("retries only transient infrastructure faults", () => {
    for (const c of ["timeout", "rate_limit", "upstream_5xx"] as const) {
      expect(isRetryableErrorClass(c)).toBe(true);
    }
    for (const c of ["invalid_request", "context_exceeded", "override_target_missing", "provider_unavailable", "upstream_4xx", "none"] as const) {
      expect(isRetryableErrorClass(c)).toBe(false);
    }
  });
});

describe("backoffDelayMs", () => {
  it("is bounded exponential capped at backoffMaxMs", () => {
    const p = { maxRetries: 5, backoffBaseMs: 100, backoffMaxMs: 400 };
    expect(backoffDelayMs(p, 0)).toBe(100);
    expect(backoffDelayMs(p, 1)).toBe(200);
    expect(backoffDelayMs(p, 2)).toBe(400);
    expect(backoffDelayMs(p, 3)).toBe(400); // capped
  });
  it("returns 0 when base is non-positive", () => {
    expect(backoffDelayMs({ maxRetries: 3, backoffBaseMs: 0, backoffMaxMs: 100 }, 0)).toBe(0);
  });
});

describe("runProviderAttempt — retry bounds", () => {
  it("does not retry on success (one call)", async () => {
    const { adapter, execute } = sequenceAdapter([okResult()]);
    const r = await runProviderAttempt({ adapter, input: INPUT, attemptIndex: 0, policy: retryPolicy(2), sleep: noSleep });
    expect(r.kind).toBe("success");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable failure then succeeds", async () => {
    const { adapter, execute } = sequenceAdapter([failResult("upstream_5xx"), failResult("rate_limit"), okResult()]);
    const r = await runProviderAttempt({ adapter, input: INPUT, attemptIndex: 0, policy: retryPolicy(2), sleep: noSleep });
    expect(r.kind).toBe("success");
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("bounds total attempts at maxRetries + 1 and returns the last failure", async () => {
    const { adapter, execute } = sequenceAdapter([failResult("upstream_5xx"), failResult("upstream_5xx"), failResult("upstream_5xx"), failResult("upstream_5xx")]);
    const r = await runProviderAttempt({ adapter, input: INPUT, attemptIndex: 0, policy: retryPolicy(2), sleep: noSleep });
    expect(r.kind).toBe("failure");
    expect(execute).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("does not retry a non-retryable (deterministic client) failure", async () => {
    const { adapter, execute } = sequenceAdapter([failResult("invalid_request"), okResult()]);
    const r = await runProviderAttempt({ adapter, input: INPUT, attemptIndex: 0, policy: retryPolicy(3), sleep: noSleep });
    expect(r.kind).toBe("failure");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("performs exactly one call when retries are disabled (default)", async () => {
    const { adapter, execute } = sequenceAdapter([failResult("upstream_5xx")]);
    const r = await runProviderAttempt({ adapter, input: INPUT, attemptIndex: 0, policy: NO_RETRY });
    expect(r.kind).toBe("failure");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("sleeps with bounded backoff between retries", async () => {
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => { delays.push(ms); });
    const { adapter } = sequenceAdapter([failResult("upstream_5xx"), failResult("upstream_5xx"), okResult()]);
    await runProviderAttempt({ adapter, input: INPUT, attemptIndex: 0, policy: retryPolicy(2), sleep });
    expect(delays).toEqual([10, 20]); // base, base*2 (under cap)
  });
});

describe("runProviderAttempt — timeout", () => {
  it("returns a structured timeout failure without hanging and cancels in-flight work", async () => {
    let aborted = false;
    const adapter: ProviderAdapter = {
      providerId: "slow",
      listModels: () => [],
      probeHealth: async () => ({ providerId: "slow", healthy: true, lastProbedAt: "", consecutiveFailures: 0 }),
      execute: (_input, signal) =>
        new Promise<ExecuteResult>(() => {
          signal.addEventListener("abort", () => { aborted = true; });
        }),
    };
    const policy: ProviderAttemptPolicy = { timeoutMs: 15, retry: { maxRetries: 0, backoffBaseMs: 0, backoffMaxMs: 0 }, requestDeadlineMs: 0 };
    const r = await runProviderAttempt({ adapter, input: { ...INPUT }, attemptIndex: 1, policy });
    expect(r.kind).toBe("failure");
    expect(r.attempt.errorClass).toBe("timeout");
    expect(r.attempt.attemptIndex).toBe(1);
    expect(r.attempt.providerId).toBe("slow");
    expect(aborted).toBe(true);
  });

  it("a timeout is retryable and can recover on a subsequent attempt", async () => {
    let calls = 0;
    const adapter: ProviderAdapter = {
      providerId: "flaky",
      listModels: () => [],
      probeHealth: async () => ({ providerId: "flaky", healthy: true, lastProbedAt: "", consecutiveFailures: 0 }),
      execute: (_input, signal) => {
        calls += 1;
        if (calls === 1) {
          return new Promise<ExecuteResult>(() => {
            signal.addEventListener("abort", () => {});
          });
        }
        return Promise.resolve(okResult());
      },
    };
    const policy: ProviderAttemptPolicy = { timeoutMs: 15, retry: { maxRetries: 1, backoffBaseMs: 0, backoffMaxMs: 0 }, requestDeadlineMs: 0 };
    const r = await runProviderAttempt({ adapter, input: INPUT, attemptIndex: 0, policy, sleep: noSleep });
    expect(r.kind).toBe("success");
    expect(calls).toBe(2);
  });

  it("maps an unexpected thrown adapter error to a non-retryable failure", async () => {
    const execute = vi.fn(async () => { throw new Error("boom"); });
    const adapter: ProviderAdapter = {
      providerId: "throws",
      listModels: () => [],
      probeHealth: async () => ({ providerId: "throws", healthy: true, lastProbedAt: "", consecutiveFailures: 0 }),
      execute,
    };
    const r = await runProviderAttempt({ adapter, input: INPUT, attemptIndex: 0, policy: retryPolicy(3), sleep: noSleep });
    expect(r.kind).toBe("failure");
    expect(r.attempt.errorClass).toBe("provider_unavailable");
    expect(execute).toHaveBeenCalledTimes(1); // not retried
  });
});

describe("runProviderAttempt — logical-request deadline", () => {
  function deadlinePolicy(maxRetries: number, timeoutMs: number): ProviderAttemptPolicy {
    return { timeoutMs, retry: { maxRetries, backoffBaseMs: 1_000, backoffMaxMs: 1_000 }, requestDeadlineMs: 0 };
  }

  it("caps the per-attempt timeout to the remaining deadline budget", async () => {
    const seen: number[] = [];
    const adapter: ProviderAdapter = {
      providerId: "cap",
      listModels: () => [],
      probeHealth: async () => ({ providerId: "cap", healthy: true, lastProbedAt: "", consecutiveFailures: 0 }),
      execute: (_input, signal) =>
        new Promise<ExecuteResult>((resolve) => {
          signal.addEventListener("abort", () => {
            seen.push(1);
            resolve(failResult("timeout"));
          });
        }),
    };
    // deadline leaves only ~20ms even though the per-attempt timeout is 10s.
    const now = () => 1_000_000;
    const deadlineAt = 1_000_020;
    const start = Date.now();
    const r = await runProviderAttempt({
      adapter,
      input: INPUT,
      attemptIndex: 0,
      policy: deadlinePolicy(0, 10_000),
      now,
      deadlineAt,
    });
    const elapsed = Date.now() - start;
    expect(r.kind).toBe("failure");
    expect(elapsed).toBeLessThan(1_000); // bounded by the ~20ms deadline, not 10s
  });

  it("skips the backoff sleep and retry when the deadline falls within the backoff window", async () => {
    const { adapter, execute } = sequenceAdapter([failResult("upstream_5xx"), okResult()]);
    const sleep = vi.fn(async () => {});
    // After the first attempt the clock is already at/after the deadline.
    const deadlineAt = 1_000_000;
    let step = 0;
    const now = () => (step++ === 0 ? 999_000 : 1_000_000);
    const r = await runProviderAttempt({
      adapter,
      input: INPUT,
      attemptIndex: 0,
      policy: { timeoutMs: 1_000, retry: { maxRetries: 3, backoffBaseMs: 10, backoffMaxMs: 10 }, requestDeadlineMs: 0 },
      now,
      deadlineAt,
      sleep,
    });
    expect(r.kind).toBe("failure");
    expect(execute).toHaveBeenCalledTimes(1); // no retry
    expect(sleep).not.toHaveBeenCalled(); // backoff skipped
  });

  it("stops retrying when the deadline is reached and returns the last failure", async () => {
    const { adapter, execute } = sequenceAdapter([
      failResult("upstream_5xx"),
      failResult("upstream_5xx"),
      okResult(),
    ]);
    let calls = 0;
    // Clock passes the deadline right after the first physical attempt.
    const deadlineAt = 1_000_000;
    const now = () => {
      calls += 1;
      return calls <= 1 ? 999_000 : 1_000_001;
    };
    const r = await runProviderAttempt({
      adapter,
      input: INPUT,
      attemptIndex: 0,
      policy: { timeoutMs: 1_000, retry: { maxRetries: 3, backoffBaseMs: 10, backoffMaxMs: 10 }, requestDeadlineMs: 0 },
      now,
      deadlineAt,
      sleep: noSleep,
    });
    expect(r.kind).toBe("failure");
    expect(execute).toHaveBeenCalledTimes(1); // deadline prevented any retry
  });

  it("behaves identically to the unbounded path when no deadline is supplied", async () => {
    const { adapter, execute } = sequenceAdapter([failResult("upstream_5xx"), okResult()]);
    const r = await runProviderAttempt({ adapter, input: INPUT, attemptIndex: 0, policy: retryPolicy(2), sleep: noSleep });
    expect(r.kind).toBe("success");
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
