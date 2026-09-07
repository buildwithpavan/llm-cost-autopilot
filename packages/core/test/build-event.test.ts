import { describe, expect, it } from "vitest";

import { buildTelemetryEvent } from "../src/telemetry/build-event.js";
import type { Attempt, RoutingDecision } from "../src/types/telemetry.js";

const BASE_DECISION: RoutingDecision = {
  decisionSource: "autopilot",
  shadowedSource: null,
  candidateRanking: [
    {
      providerId: "mock-cheap",
      modelId: "mock-cheap:small",
      included: true,
      exclusionReason: null,
      scoreBreakdown: { total: 0.9 },
    },
    {
      providerId: "mock-fast",
      modelId: "mock-fast:default",
      included: true,
      exclusionReason: null,
      scoreBreakdown: { total: 0.7 },
    },
  ],
  chosenModelId: "mock-cheap:small",
  chosenProviderId: "mock-cheap",
  rationale: [{ factor: "cost", verdict: "preferred", note: "lowest" }],
  pricingTableVersionId: "seed-v1",
  estimatedCostUsd: "0.001",
};

const OK_ATTEMPT: Attempt = {
  attemptIndex: 0,
  providerId: "mock-cheap",
  modelId: "mock-cheap:small",
  startedAt: "2026-09-08T00:00:00.000Z",
  endedAt: "2026-09-08T00:00:00.100Z",
  latencyMs: 100,
  inputTokens: 10,
  outputTokens: 5,
  errorClass: "none",
  estimatedCostUsd: "0.001",
  actualCostUsd: "0.001",
  pricingTableVersionId: "seed-v1",
};

const FAIL_ATTEMPT: Attempt = {
  attemptIndex: 0,
  providerId: "mock-cheap",
  modelId: "mock-cheap:small",
  startedAt: "2026-09-08T00:00:00.000Z",
  endedAt: "2026-09-08T00:00:00.050Z",
  latencyMs: 50,
  inputTokens: null,
  outputTokens: null,
  errorClass: "upstream_5xx",
  estimatedCostUsd: "0",
  actualCostUsd: null,
  pricingTableVersionId: "seed-v1",
};

const FALLBACK_ATTEMPT: Attempt = {
  attemptIndex: 1,
  providerId: "mock-fast",
  modelId: "mock-fast:default",
  startedAt: "2026-09-08T00:00:00.055Z",
  endedAt: "2026-09-08T00:00:00.180Z",
  latencyMs: 125,
  inputTokens: 10,
  outputTokens: 5,
  errorClass: "none",
  estimatedCostUsd: "0.0005",
  actualCostUsd: "0.0005",
  pricingTableVersionId: "seed-v1",
};

const OPTS = {
  eventId: "01924b1a-4c9f-7000-b000-000000000001",
  receivedAt: "2026-09-08T00:00:00.000Z",
  clientId: "c1",
};

describe("buildTelemetryEvent", () => {
  it("assembles a single-attempt success event with reconciliation flag true", () => {
    const event = buildTelemetryEvent({
      ...OPTS,
      decision: BASE_DECISION,
      attempts: [OK_ATTEMPT],
      totalLatencyMs: 100,
    });
    expect(event.attempts).toHaveLength(1);
    expect(event.terminalErrorClass).toBe("none");
    expect(event.effectiveProviderId).toBe("mock-cheap");
    expect(event.effectiveModelId).toBe("mock-cheap:small");
    expect(event.reconciled).toBe(true);
    expect(event.aggregatedInputTokens).toBe(10);
    expect(event.aggregatedOutputTokens).toBe(5);
    expect(event.pricingTableVersionId).toBe("seed-v1");
    expect(event.routingRationale).toEqual(BASE_DECISION);
  });

  it("records a two-attempt fallback and sums cost estimates across attempts", () => {
    const event = buildTelemetryEvent({
      ...OPTS,
      decision: BASE_DECISION,
      attempts: [FAIL_ATTEMPT, FALLBACK_ATTEMPT],
      totalLatencyMs: 180,
    });
    expect(event.attempts).toHaveLength(2);
    expect(event.terminalErrorClass).toBe("none");
    expect(event.effectiveProviderId).toBe("mock-fast");
    expect(event.effectiveModelId).toBe("mock-fast:default");
    expect(event.aggregatedInputTokens).toBe(10);
    expect(event.aggregatedOutputTokens).toBe(5);
    // estimatedCost = 0 (failed) + 0.0005 = 0.0005
    expect(event.estimatedCostUsd).toBe("0.0005");
  });

  it("records a terminal failure with null actualCost and null reconciled", () => {
    const event = buildTelemetryEvent({
      ...OPTS,
      decision: BASE_DECISION,
      attempts: [FAIL_ATTEMPT],
      totalLatencyMs: 50,
    });
    expect(event.terminalErrorClass).toBe("upstream_5xx");
    expect(event.actualCostUsd).toBeNull();
    expect(event.reconciled).toBeNull();
  });

  it("preserves shadowedSource when the decision source is operator_rule", () => {
    const decision = {
      ...BASE_DECISION,
      decisionSource: "operator_rule" as const,
      shadowedSource: "client_override" as const,
    };
    const event = buildTelemetryEvent({
      ...OPTS,
      decision,
      attempts: [OK_ATTEMPT],
      totalLatencyMs: 100,
    });
    expect(event.decisionSource).toBe("operator_rule");
    expect(event.shadowedSource).toBe("client_override");
  });

  it("throws when attempts array is empty (contract invariant)", () => {
    expect(() =>
      buildTelemetryEvent({
        ...OPTS,
        decision: BASE_DECISION,
        attempts: [],
        totalLatencyMs: 0,
      }),
    ).toThrow(/attempts/i);
  });

  it("throws when attempts length exceeds MVP bound (2)", () => {
    expect(() =>
      buildTelemetryEvent({
        ...OPTS,
        decision: BASE_DECISION,
        attempts: [FAIL_ATTEMPT, FAIL_ATTEMPT, FALLBACK_ATTEMPT],
        totalLatencyMs: 0,
      }),
    ).toThrow(/attempts.*2/i);
  });

  it("rejects a two-attempt chain where the first error is non-transient (FR-033)", () => {
    const badFirst: Attempt = { ...FAIL_ATTEMPT, errorClass: "upstream_4xx" };
    expect(() =>
      buildTelemetryEvent({
        ...OPTS,
        decision: BASE_DECISION,
        attempts: [badFirst, FALLBACK_ATTEMPT],
        totalLatencyMs: 180,
      }),
    ).toThrow(/transient/i);
  });
});
