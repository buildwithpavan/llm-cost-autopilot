import { describe, expect, it, vi } from "vitest";

import { executeWithFallback } from "../src/routing/execute-with-fallback.js";
import type {
  Attempt,
  ErrorClass,
  NormalizedRequest,
  PricingTable,
  RoutingDecision,
} from "../src/index.js";

const PRICING: PricingTable = {
  versionId: "seed-v1",
  effectiveFrom: "2026-09-08T00:00:00.000Z",
  entries: [
    {
      providerId: "primary",
      modelId: "primary:m",
      unitInputUsdPerToken: "0.000001",
      unitOutputUsdPerToken: "0.000002",
      currency: "USD",
    },
    {
      providerId: "fallback",
      modelId: "fallback:m",
      unitInputUsdPerToken: "0.000001",
      unitOutputUsdPerToken: "0.000002",
      currency: "USD",
    },
  ],
};

function mkRequest(): NormalizedRequest {
  return {
    requestId: "01924b1a-4c9f-7000-b000-000000000001",
    clientId: "c",
    receivedAt: "2026-09-08T00:00:00.000Z",
    messages: [{ role: "user", content: "hi" }],
    requirements: { requiredCapabilities: [] },
    override: null,
    estimatedInputTokens: 10,
  };
}

function mkDecision(source: RoutingDecision["decisionSource"] = "autopilot"): RoutingDecision {
  return {
    decisionSource: source,
    shadowedSource: null,
    candidateRanking: [
      {
        providerId: "primary",
        modelId: "primary:m",
        included: true,
        exclusionReason: null,
        scoreBreakdown: { total: 0.9 },
      },
      {
        providerId: "fallback",
        modelId: "fallback:m",
        included: true,
        exclusionReason: null,
        scoreBreakdown: { total: 0.7 },
      },
    ],
    chosenProviderId: "primary",
    chosenModelId: "primary:m",
    rationale: [],
    pricingTableVersionId: "seed-v1",
    estimatedCostUsd: "0",
  };
}

function mkAttempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    attemptIndex: 0,
    providerId: "primary",
    modelId: "primary:m",
    startedAt: "2026-09-08T00:00:00.000Z",
    endedAt: "2026-09-08T00:00:00.010Z",
    latencyMs: 10,
    inputTokens: 10,
    outputTokens: 5,
    errorClass: "none",
    estimatedCostUsd: "0",
    actualCostUsd: null,
    pricingTableVersionId: "seed-v1",
    ...overrides,
  };
}

describe("executeWithFallback (FR-033/034/035)", () => {
  it("returns a single success attempt when the first call succeeds", async () => {
    const execute = vi.fn(async () => ({
      kind: "success" as const,
      content: "ok",
      finishReason: "stop",
      attempt: mkAttempt({ errorClass: "none" }),
    }));
    const result = await executeWithFallback({
      request: mkRequest(),
      decision: mkDecision(),
      pricingTable: PRICING,
      execute,
    });
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!.errorClass).toBe("none");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.terminalErrorClass).toBe("none");
  });

  it("does not fallback on non-transient errors (4xx / invalid_request)", async () => {
    for (const errorClass of ["upstream_4xx", "invalid_request", "context_exceeded"] as ErrorClass[]) {
      const execute = vi.fn(async () => ({
        kind: "failure" as const,
        attempt: mkAttempt({ errorClass }),
      }));
      const result = await executeWithFallback({
        request: mkRequest(),
        decision: mkDecision(),
        pricingTable: PRICING,
        execute,
      });
      expect(result.attempts).toHaveLength(1);
      expect(result.terminalErrorClass).toBe(errorClass);
      expect(execute).toHaveBeenCalledTimes(1);
    }
  });

  it("performs exactly one fallback on transient failures (timeout, rate_limit, upstream_5xx)", async () => {
    for (const errorClass of ["timeout", "rate_limit", "upstream_5xx"] as ErrorClass[]) {
      let call = 0;
      const execute = vi.fn(async () => {
        call++;
        if (call === 1) {
          return { kind: "failure" as const, attempt: mkAttempt({ errorClass, attemptIndex: 0 }) };
        }
        return {
          kind: "success" as const,
          content: "recovered",
          finishReason: "stop",
          attempt: mkAttempt({
            attemptIndex: 1,
            providerId: "fallback",
            modelId: "fallback:m",
            errorClass: "none",
          }),
        };
      });
      const result = await executeWithFallback({
        request: mkRequest(),
        decision: mkDecision(),
        pricingTable: PRICING,
        execute,
      });
      expect(result.attempts).toHaveLength(2);
      expect(result.attempts[0]!.errorClass).toBe(errorClass);
      expect(result.attempts[1]!.errorClass).toBe("none");
      expect(result.attempts[1]!.providerId).toBe("fallback");
      expect(result.terminalErrorClass).toBe("none");
      expect(execute).toHaveBeenCalledTimes(2);
    }
  });

  it("does NOT fallback when the decision source is a client_override", async () => {
    let call = 0;
    const execute = vi.fn(async () => {
      call++;
      return { kind: "failure" as const, attempt: mkAttempt({ errorClass: "upstream_5xx" }) };
    });
    const result = await executeWithFallback({
      request: mkRequest(),
      decision: mkDecision("client_override"),
      pricingTable: PRICING,
      execute,
    });
    expect(result.attempts).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.terminalErrorClass).toBe("upstream_5xx");
    void call;
  });

  it("does NOT fallback when the decision source is an operator_rule", async () => {
    const execute = vi.fn(async () => ({
      kind: "failure" as const,
      attempt: mkAttempt({ errorClass: "upstream_5xx" }),
    }));
    const result = await executeWithFallback({
      request: mkRequest(),
      decision: mkDecision("operator_rule"),
      pricingTable: PRICING,
      execute,
    });
    expect(result.attempts).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does NOT fallback when there is no next candidate", async () => {
    const decision = mkDecision();
    decision.candidateRanking = [decision.candidateRanking[0]!]; // only primary
    const execute = vi.fn(async () => ({
      kind: "failure" as const,
      attempt: mkAttempt({ errorClass: "upstream_5xx" }),
    }));
    const result = await executeWithFallback({
      request: mkRequest(),
      decision,
      pricingTable: PRICING,
      execute,
    });
    expect(result.attempts).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.terminalErrorClass).toBe("upstream_5xx");
  });

  it("caps attempts chain at length 2 even when the fallback also fails transiently", async () => {
    const execute = vi.fn(async () => ({
      kind: "failure" as const,
      attempt: mkAttempt({ errorClass: "upstream_5xx" }),
    }));
    const result = await executeWithFallback({
      request: mkRequest(),
      decision: mkDecision(),
      pricingTable: PRICING,
      execute,
    });
    expect(result.attempts.length).toBeLessThanOrEqual(2);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.terminalErrorClass).toBe("terminal_fallback_exhausted");
  });

  it("marks attempt indexes correctly (0 for initial, 1 for fallback)", async () => {
    let call = 0;
    const execute = vi.fn(async () => {
      call++;
      return call === 1
        ? { kind: "failure" as const, attempt: mkAttempt({ errorClass: "timeout" }) }
        : {
            kind: "success" as const,
            content: "ok",
            finishReason: "stop",
            attempt: mkAttempt({
              providerId: "fallback",
              modelId: "fallback:m",
              errorClass: "none",
            }),
          };
    });
    const result = await executeWithFallback({
      request: mkRequest(),
      decision: mkDecision(),
      pricingTable: PRICING,
      execute,
    });
    expect(result.attempts[0]!.attemptIndex).toBe(0);
    expect(result.attempts[1]!.attemptIndex).toBe(1);
  });
});
