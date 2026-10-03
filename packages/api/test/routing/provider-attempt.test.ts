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

const NO_RETRY: ProviderAttemptPolicy = { timeoutMs: 1_000, retry: { maxRetries: 0, backoffBaseMs: 0, backoffMaxMs: 0 } };
function retryPolicy(maxRetries: number): ProviderAttemptPolicy {
  return { timeoutMs: 1_000, retry: { maxRetries, backoffBaseMs: 10, backoffMaxMs: 100 } };
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
    const policy: ProviderAttemptPolicy = { timeoutMs: 15, retry: { maxRetries: 0, backoffBaseMs: 0, backoffMaxMs: 0 } };
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
    const policy: ProviderAttemptPolicy = { timeoutMs: 15, retry: { maxRetries: 1, backoffBaseMs: 0, backoffMaxMs: 0 } };
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
