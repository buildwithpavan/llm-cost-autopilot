import { describe, expect, it } from "vitest";

import { resolveOverride } from "../src/overrides/resolve.js";
import type {
  ClientOverride,
  NormalizedRequest,
  OperatorRule,
} from "../src/index.js";

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
    pin: { providerId: "operator-pinned", modelId: null },
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    ...over,
  };
}

const clientPin: ClientOverride = { providerId: "client-pinned", modelId: null };

describe("resolveOverride (FR-027 precedence)", () => {
  it("returns autopilot when neither an operator rule nor a client override applies", () => {
    const result = resolveOverride({ request: mkReq(), rules: [] });
    expect(result.effectiveSource).toBe("autopilot");
    expect(result.shadowedSource).toBeNull();
    expect(result.pin).toBeNull();
  });

  it("returns client_override when a valid client override is present and no rule matches", () => {
    const result = resolveOverride({
      request: mkReq({ override: clientPin }),
      rules: [],
    });
    expect(result.effectiveSource).toBe("client_override");
    expect(result.shadowedSource).toBeNull();
    expect(result.pin).toEqual(clientPin);
  });

  it("returns operator_rule when a rule matches and no client override is set", () => {
    const rule = mkRule();
    const result = resolveOverride({ request: mkReq(), rules: [rule] });
    expect(result.effectiveSource).toBe("operator_rule");
    expect(result.shadowedSource).toBeNull();
    expect(result.pin).toEqual(rule.pin);
    expect(result.matchedRuleId).toBe(rule.ruleId);
  });

  it("returns operator_rule and records shadowed client_override when both apply", () => {
    const rule = mkRule();
    const result = resolveOverride({
      request: mkReq({ override: clientPin }),
      rules: [rule],
    });
    expect(result.effectiveSource).toBe("operator_rule");
    expect(result.shadowedSource).toBe("client_override");
    expect(result.pin).toEqual(rule.pin);
  });

  it("selects the lowest-priority-number rule when multiple rules match", () => {
    const ruleLow = mkRule({
      ruleId: "priority-1",
      priority: 1,
      pin: { providerId: "low-priority-pin", modelId: null },
    });
    const ruleHigh = mkRule({
      ruleId: "priority-100",
      priority: 100,
      pin: { providerId: "high-priority-pin", modelId: null },
    });
    const result = resolveOverride({
      request: mkReq(),
      rules: [ruleHigh, ruleLow], // deliberately out of order
    });
    expect(result.effectiveSource).toBe("operator_rule");
    expect(result.matchedRuleId).toBe("priority-1");
    expect(result.pin).toEqual(ruleLow.pin);
  });

  it("skips disabled rules", () => {
    const disabled = mkRule({ enabled: false });
    const result = resolveOverride({ request: mkReq(), rules: [disabled] });
    expect(result.effectiveSource).toBe("autopilot");
    expect(result.pin).toBeNull();
  });

  it("skips rules whose match block does not match", () => {
    const nonMatching = mkRule({
      match: {
        clientIds: ["other-client"],
        requiredCapabilities: null,
        minEstimatedTokens: null,
        maxEstimatedTokens: null,
      },
    });
    const result = resolveOverride({ request: mkReq(), rules: [nonMatching] });
    expect(result.effectiveSource).toBe("autopilot");
  });
});
