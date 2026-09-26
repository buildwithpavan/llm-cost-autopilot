import { describe, expect, it } from "vitest";
import type { OperatorRule } from "../src/types";
import {
  CAPABILITIES,
  buildPayload,
  emptyForm,
  formFromRule,
  hasErrors,
  normalizeClientIds,
  toggleCapability,
  validateForm,
  type RuleFormState,
} from "../src/features/governance/rules/rule-form";

function form(over: Partial<RuleFormState>): RuleFormState {
  return { ...emptyForm(), ...over };
}

describe("validateForm — priority", () => {
  it("accepts negative, zero, and positive integers", () => {
    expect(hasErrors(validateForm(form({ priority: "-5", providerId: "openai" })))).toBe(false);
    expect(hasErrors(validateForm(form({ priority: "0", providerId: "openai" })))).toBe(false);
    expect(hasErrors(validateForm(form({ priority: "42", providerId: "openai" })))).toBe(false);
  });

  it("rejects non-integer priority", () => {
    expect(validateForm(form({ priority: "1.5", providerId: "openai" })).priority).toBeDefined();
    expect(validateForm(form({ priority: "abc", providerId: "openai" })).priority).toBeDefined();
    expect(validateForm(form({ priority: "", providerId: "openai" })).priority).toBeDefined();
  });
});

describe("validateForm — tokens", () => {
  it("accepts zero token values", () => {
    const errors = validateForm(form({ minTokens: "0", maxTokens: "0", providerId: "openai" }));
    expect(hasErrors(errors)).toBe(false);
  });

  it("rejects negative token values", () => {
    expect(validateForm(form({ minTokens: "-1", providerId: "openai" })).minTokens).toBeDefined();
    expect(validateForm(form({ maxTokens: "-3", providerId: "openai" })).maxTokens).toBeDefined();
  });

  it("rejects non-integer token values", () => {
    expect(validateForm(form({ minTokens: "1.2", providerId: "openai" })).minTokens).toBeDefined();
  });

  it("rejects min > max", () => {
    expect(validateForm(form({ minTokens: "100", maxTokens: "50", providerId: "openai" })).tokenRange).toBeDefined();
  });

  it("accepts min == max and min < max", () => {
    expect(hasErrors(validateForm(form({ minTokens: "50", maxTokens: "50", providerId: "openai" })))).toBe(false);
    expect(hasErrors(validateForm(form({ minTokens: "10", maxTokens: "5000", providerId: "openai" })))).toBe(false);
  });
});

describe("validateForm — pin", () => {
  it("accepts provider-only", () => {
    expect(validateForm(form({ providerId: "openai", modelId: "" })).pin).toBeUndefined();
  });
  it("accepts model-only", () => {
    expect(validateForm(form({ providerId: "", modelId: "gpt-4o" })).pin).toBeUndefined();
  });
  it("accepts both", () => {
    expect(validateForm(form({ providerId: "openai", modelId: "gpt-4o" })).pin).toBeUndefined();
  });
  it("rejects both empty (including whitespace)", () => {
    expect(validateForm(form({ providerId: "", modelId: "" })).pin).toBeDefined();
    expect(validateForm(form({ providerId: "  ", modelId: "  " })).pin).toBeDefined();
  });
});

describe("normalizeClientIds", () => {
  it("trims and drops empty entries", () => {
    expect(normalizeClientIds([" acme ", "", "globex", "   "])).toEqual(["acme", "globex"]);
  });
});

describe("toggleCapability", () => {
  it("adds then removes a capability", () => {
    expect(toggleCapability([], "vision")).toEqual(["vision"]);
    expect(toggleCapability(["vision"], "vision")).toEqual([]);
  });
  it("only exposes the known enum", () => {
    expect(CAPABILITIES).toEqual(["tool_use", "json_mode", "function_calling", "vision"]);
  });
});

describe("buildPayload", () => {
  it("collapses empty client IDs and capabilities to null (Any)", () => {
    const p = buildPayload(form({ priority: "3", providerId: "openai" }));
    expect(p.match.clientIds).toBeNull();
    expect(p.match.requiredCapabilities).toBeNull();
    expect(p.match.minEstimatedTokens).toBeNull();
    expect(p.match.maxEstimatedTokens).toBeNull();
  });

  it("trims client IDs and preserves selected capabilities", () => {
    const p = buildPayload(
      form({ clientIds: [" acme ", "", "globex"], capabilities: ["tool_use", "vision"], providerId: "openai" }),
    );
    expect(p.match.clientIds).toEqual(["acme", "globex"]);
    expect(p.match.requiredCapabilities).toEqual(["tool_use", "vision"]);
  });

  it("preserves exact numeric priority including negatives and zero", () => {
    expect(buildPayload(form({ priority: "-7", providerId: "openai" })).priority).toBe(-7);
    expect(buildPayload(form({ priority: "0", providerId: "openai" })).priority).toBe(0);
  });

  it("keeps zero token bounds as 0 (not null)", () => {
    const p = buildPayload(form({ minTokens: "0", maxTokens: "0", providerId: "openai" }));
    expect(p.match.minEstimatedTokens).toBe(0);
    expect(p.match.maxEstimatedTokens).toBe(0);
  });

  it("supports provider-only, model-only, and both pins", () => {
    expect(buildPayload(form({ providerId: "openai", modelId: "" })).pin).toEqual({ providerId: "openai", modelId: null });
    expect(buildPayload(form({ providerId: "", modelId: "gpt-4o" })).pin).toEqual({ providerId: null, modelId: "gpt-4o" });
    expect(buildPayload(form({ providerId: "openai", modelId: "gpt-4o" })).pin).toEqual({ providerId: "openai", modelId: "gpt-4o" });
  });

  it("preserves the enabled flag", () => {
    expect(buildPayload(form({ enabled: false, providerId: "openai" })).enabled).toBe(false);
    expect(buildPayload(form({ enabled: true, providerId: "openai" })).enabled).toBe(true);
  });

  it("never emits ruleId/createdAt/updatedAt", () => {
    const p = buildPayload(form({ providerId: "openai" })) as Record<string, unknown>;
    expect(p).not.toHaveProperty("ruleId");
    expect(p).not.toHaveProperty("createdAt");
    expect(p).not.toHaveProperty("updatedAt");
    expect(Object.keys(p).sort()).toEqual(["enabled", "match", "pin", "priority"]);
  });
});

describe("formFromRule", () => {
  it("round-trips null match/pin into blank/empty inputs", () => {
    const rule: OperatorRule = {
      ruleId: "rule_x",
      priority: -2,
      enabled: false,
      match: { clientIds: null, requiredCapabilities: null, minEstimatedTokens: null, maxEstimatedTokens: null },
      pin: { providerId: "anthropic", modelId: null },
      createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T00:00:00.000Z",
    };
    const state = formFromRule(rule);
    expect(state.priority).toBe("-2");
    expect(state.enabled).toBe(false);
    expect(state.clientIds).toEqual([]);
    expect(state.capabilities).toEqual([]);
    expect(state.minTokens).toBe("");
    expect(state.maxTokens).toBe("");
    expect(state.providerId).toBe("anthropic");
    expect(state.modelId).toBe("");

    // Round-trip back to a payload preserves the null representation.
    const payload = buildPayload(state);
    expect(payload.match.clientIds).toBeNull();
    expect(payload.pin).toEqual({ providerId: "anthropic", modelId: null });
  });
});
