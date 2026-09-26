import { describe, expect, it } from "vitest";
import type { RuleMatch, RulePin } from "../src/types";
import {
  ANY_LABEL,
  formatEnabled,
  formatMatchConditions,
  formatPin,
  formatPriority,
  formatTokenBounds,
  isMatchAny,
} from "../src/features/governance/rules/rule-presenters";

function match(over: Partial<RuleMatch>): RuleMatch {
  return {
    clientIds: null,
    requiredCapabilities: null,
    minEstimatedTokens: null,
    maxEstimatedTokens: null,
    ...over,
  };
}

describe("formatMatchConditions", () => {
  it("passes through client IDs", () => {
    const v = formatMatchConditions(match({ clientIds: ["acme", "globex"] }));
    expect(v.clientIds).toEqual(["acme", "globex"]);
  });

  it("passes through required capabilities", () => {
    const v = formatMatchConditions(match({ requiredCapabilities: ["tool_use", "vision"] }));
    expect(v.capabilities).toEqual(["tool_use", "vision"]);
  });

  it("treats null clientIds and capabilities as empty (Any)", () => {
    const v = formatMatchConditions(match({}));
    expect(v.clientIds).toEqual([]);
    expect(v.capabilities).toEqual([]);
    expect(v.tokens).toBeNull();
    expect(isMatchAny(v)).toBe(true);
  });

  it("is not Any when any single condition is present", () => {
    expect(isMatchAny(formatMatchConditions(match({ clientIds: ["a"] })))).toBe(false);
    expect(isMatchAny(formatMatchConditions(match({ requiredCapabilities: ["json_mode"] })))).toBe(false);
    expect(isMatchAny(formatMatchConditions(match({ minEstimatedTokens: 1 })))).toBe(false);
  });
});

describe("formatTokenBounds", () => {
  it("formats both bounds as a range", () => {
    expect(formatTokenBounds(100, 2000)).toBe("tokens:100–2000");
  });

  it("formats a min-only bound", () => {
    expect(formatTokenBounds(500, null)).toBe("tokens:≥500");
  });

  it("formats a max-only bound", () => {
    expect(formatTokenBounds(null, 4096)).toBe("tokens:≤4096");
  });

  it("returns null when neither bound is set", () => {
    expect(formatTokenBounds(null, null)).toBeNull();
  });

  it("handles a zero bound", () => {
    expect(formatTokenBounds(0, 0)).toBe("tokens:0–0");
  });
});

describe("formatPin", () => {
  it("renders provider:model when both exist", () => {
    expect(formatPin(pin({ providerId: "openai", modelId: "gpt-4o" }))).toBe("openai:gpt-4o");
  });

  it("renders provider only when modelId is null", () => {
    expect(formatPin(pin({ providerId: "anthropic", modelId: null }))).toBe("anthropic");
  });

  it("renders model only when providerId is null", () => {
    expect(formatPin(pin({ providerId: null, modelId: "claude-3-5-sonnet" }))).toBe("claude-3-5-sonnet");
  });
});

describe("formatEnabled", () => {
  it("presents an enabled rule", () => {
    expect(formatEnabled(true)).toEqual({ label: "Enabled", tone: "active" });
  });

  it("presents a disabled rule", () => {
    expect(formatEnabled(false)).toEqual({ label: "Disabled", tone: "muted" });
  });
});

describe("formatPriority", () => {
  it("renders arbitrary integers verbatim, including zero and negatives", () => {
    expect(formatPriority(0)).toBe("0");
    expect(formatPriority(-5)).toBe("-5");
    expect(formatPriority(42)).toBe("42");
    expect(formatPriority(1000)).toBe("1000");
  });
});

describe("ANY_LABEL", () => {
  it("is the neutral label for absent conditions", () => {
    expect(ANY_LABEL).toBe("Any");
  });
});

function pin(over: Partial<RulePin>): RulePin {
  return { providerId: null, modelId: null, ...over } as RulePin;
}
