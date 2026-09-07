import { describe, expect, it } from "vitest";

import { matchesRule } from "../src/overrides/match.js";
import type { NormalizedRequest, OperatorRule } from "../src/index.js";

function mkReq(over: Partial<NormalizedRequest> = {}): NormalizedRequest {
  return {
    requestId: "01924b1a-4c9f-7000-b000-000000000001",
    clientId: "client-a",
    receivedAt: "2026-09-08T00:00:00.000Z",
    messages: [{ role: "user", content: "hi" }],
    requirements: { requiredCapabilities: [] },
    override: null,
    estimatedInputTokens: 100,
    ...over,
  };
}

function mkRule(over: Partial<OperatorRule> = {}): OperatorRule {
  return {
    ruleId: "rule-1",
    priority: 10,
    enabled: true,
    match: {
      clientIds: null,
      requiredCapabilities: null,
      minEstimatedTokens: null,
      maxEstimatedTokens: null,
    },
    pin: { providerId: "mock-cheap", modelId: null },
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    ...over,
  };
}

describe("matchesRule", () => {
  it("matches an all-null rule against any request", () => {
    expect(matchesRule(mkRule(), mkReq())).toBe(true);
  });

  it("does not match disabled rules", () => {
    expect(matchesRule(mkRule({ enabled: false }), mkReq())).toBe(false);
  });

  it("matches when clientIds contains the request's clientId", () => {
    const rule = mkRule({
      match: {
        clientIds: ["client-a", "client-b"],
        requiredCapabilities: null,
        minEstimatedTokens: null,
        maxEstimatedTokens: null,
      },
    });
    expect(matchesRule(rule, mkReq({ clientId: "client-a" }))).toBe(true);
    expect(matchesRule(rule, mkReq({ clientId: "client-c" }))).toBe(false);
  });

  it("matches when the request declares all required capabilities", () => {
    const rule = mkRule({
      match: {
        clientIds: null,
        requiredCapabilities: ["tool_use", "json_mode"],
        minEstimatedTokens: null,
        maxEstimatedTokens: null,
      },
    });
    expect(
      matchesRule(
        rule,
        mkReq({ requirements: { requiredCapabilities: ["tool_use", "json_mode", "vision"] } }),
      ),
    ).toBe(true);
    expect(
      matchesRule(
        rule,
        mkReq({ requirements: { requiredCapabilities: ["tool_use"] } }),
      ),
    ).toBe(false);
  });

  it("respects minEstimatedTokens (inclusive)", () => {
    const rule = mkRule({
      match: {
        clientIds: null,
        requiredCapabilities: null,
        minEstimatedTokens: 100,
        maxEstimatedTokens: null,
      },
    });
    expect(matchesRule(rule, mkReq({ estimatedInputTokens: 99 }))).toBe(false);
    expect(matchesRule(rule, mkReq({ estimatedInputTokens: 100 }))).toBe(true);
    expect(matchesRule(rule, mkReq({ estimatedInputTokens: 1000 }))).toBe(true);
  });

  it("respects maxEstimatedTokens (inclusive)", () => {
    const rule = mkRule({
      match: {
        clientIds: null,
        requiredCapabilities: null,
        minEstimatedTokens: null,
        maxEstimatedTokens: 500,
      },
    });
    expect(matchesRule(rule, mkReq({ estimatedInputTokens: 500 }))).toBe(true);
    expect(matchesRule(rule, mkReq({ estimatedInputTokens: 501 }))).toBe(false);
  });

  it("combines all four constraints (AND semantics)", () => {
    const rule = mkRule({
      match: {
        clientIds: ["client-a"],
        requiredCapabilities: ["tool_use"],
        minEstimatedTokens: 10,
        maxEstimatedTokens: 200,
      },
    });
    const matching = mkReq({
      clientId: "client-a",
      requirements: { requiredCapabilities: ["tool_use"] },
      estimatedInputTokens: 100,
    });
    expect(matchesRule(rule, matching)).toBe(true);

    // Fails on clientId
    expect(matchesRule(rule, { ...matching, clientId: "client-b" })).toBe(false);
    // Fails on capabilities
    expect(
      matchesRule(rule, { ...matching, requirements: { requiredCapabilities: [] } }),
    ).toBe(false);
    // Fails on tokens
    expect(matchesRule(rule, { ...matching, estimatedInputTokens: 201 })).toBe(false);
  });
});
