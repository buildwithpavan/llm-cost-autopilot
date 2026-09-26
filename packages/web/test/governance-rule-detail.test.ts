import { describe, expect, it } from "vitest";
import type { OperatorRule } from "../src/types";
import { enabledPatch } from "../src/features/governance/rules/rule-mutations";
import {
  formatEnabled,
  formatMatchConditions,
  formatPin,
  formatPriority,
  isMatchAny,
} from "../src/features/governance/rules/rule-presenters";

function rule(over: Partial<OperatorRule>): OperatorRule {
  return {
    ruleId: "rule_1",
    priority: 10,
    enabled: true,
    match: {
      clientIds: null,
      requiredCapabilities: null,
      minEstimatedTokens: null,
      maxEstimatedTokens: null,
    },
    pin: { providerId: "openai", modelId: null },
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    ...over,
  };
}

describe("enabledPatch", () => {
  it("carries only the enabled field", () => {
    expect(Object.keys(enabledPatch(true))).toEqual(["enabled"]);
    expect(enabledPatch(true)).toEqual({ enabled: true });
    expect(enabledPatch(false)).toEqual({ enabled: false });
  });

  it("does not include priority, match, or pin", () => {
    const patch = enabledPatch(false) as Record<string, unknown>;
    expect(patch).not.toHaveProperty("priority");
    expect(patch).not.toHaveProperty("match");
    expect(patch).not.toHaveProperty("pin");
    expect(patch).not.toHaveProperty("ruleId");
  });
});

describe("detail presentation", () => {
  it("preserves arbitrary priorities verbatim", () => {
    expect(formatPriority(rule({ priority: -7 }).priority)).toBe("-7");
    expect(formatPriority(rule({ priority: 0 }).priority)).toBe("0");
    expect(formatPriority(rule({ priority: 9999 }).priority)).toBe("9999");
  });

  it("presents fully-null match as Any", () => {
    const view = formatMatchConditions(rule({}).match);
    expect(view.clientIds).toEqual([]);
    expect(view.capabilities).toEqual([]);
    expect(view.tokens).toBeNull();
    expect(isMatchAny(view)).toBe(true);
  });

  it("keeps enabled/disabled presentation distinct", () => {
    expect(formatEnabled(rule({ enabled: true }).enabled)).toEqual({ label: "Enabled", tone: "active" });
    expect(formatEnabled(rule({ enabled: false }).enabled)).toEqual({ label: "Disabled", tone: "muted" });
  });

  it("does not infer a missing pin side", () => {
    expect(formatPin(rule({ pin: { providerId: "openai", modelId: null } }).pin)).toBe("openai");
    expect(formatPin(rule({ pin: { providerId: null, modelId: "gpt-4o" } }).pin)).toBe("gpt-4o");
    expect(formatPin(rule({ pin: { providerId: "openai", modelId: "gpt-4o" } }).pin)).toBe("openai:gpt-4o");
  });

  it("keeps null pin fields null (not inferred)", () => {
    const r = rule({ pin: { providerId: "anthropic", modelId: null } });
    expect(r.pin.providerId).toBe("anthropic");
    expect(r.pin.modelId).toBeNull();
  });
});
