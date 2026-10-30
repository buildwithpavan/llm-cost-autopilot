import { describe, expect, it } from "vitest";

import type { PlaygroundFormState } from "../src/features/playground/playground-form";
import {
  CAPABILITIES,
  buildCompletionRequest,
  emptyPlaygroundForm,
  hasErrors,
  toggleCapability,
  validatePlaygroundForm,
} from "../src/features/playground/playground-form";

function form(over: Partial<PlaygroundFormState>): PlaygroundFormState {
  return { ...emptyPlaygroundForm(), ...over };
}

describe("validatePlaygroundForm", () => {
  it("accepts a minimal valid prompt", () => {
    expect(hasErrors(validatePlaygroundForm(form({ prompt: "hello" })))).toBe(false);
  });

  it("rejects a blank/whitespace prompt", () => {
    expect(validatePlaygroundForm(form({ prompt: "" })).prompt).toBeDefined();
    expect(validatePlaygroundForm(form({ prompt: "   " })).prompt).toBeDefined();
  });

  it("validates max latency as a positive integer", () => {
    expect(validatePlaygroundForm(form({ prompt: "x", maxLatencyMs: "2000" })).maxLatencyMs).toBeUndefined();
    expect(validatePlaygroundForm(form({ prompt: "x", maxLatencyMs: "0" })).maxLatencyMs).toBeDefined();
    expect(validatePlaygroundForm(form({ prompt: "x", maxLatencyMs: "1.5" })).maxLatencyMs).toBeDefined();
    expect(validatePlaygroundForm(form({ prompt: "x", maxLatencyMs: "abc" })).maxLatencyMs).toBeDefined();
  });

  it("validates max cost as a decimal USD amount", () => {
    expect(validatePlaygroundForm(form({ prompt: "x", maxCostUsd: "0.01" })).maxCostUsd).toBeUndefined();
    expect(validatePlaygroundForm(form({ prompt: "x", maxCostUsd: "-1" })).maxCostUsd).toBeDefined();
    expect(validatePlaygroundForm(form({ prompt: "x", maxCostUsd: "1.2.3" })).maxCostUsd).toBeDefined();
  });
});

describe("toggleCapability", () => {
  it("adds then removes a capability", () => {
    expect(toggleCapability([], "vision")).toEqual(["vision"]);
    expect(toggleCapability(["vision"], "vision")).toEqual([]);
    expect(CAPABILITIES).toEqual(["tool_use", "json_mode", "function_calling", "vision"]);
  });
});

describe("buildCompletionRequest", () => {
  it("includes only a user message when no system prompt is set", () => {
    const body = buildCompletionRequest(form({ prompt: "hi" }));
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(body.requirements).toBeUndefined();
    expect(body.override).toBeUndefined();
  });

  it("prepends a system message when provided", () => {
    const body = buildCompletionRequest(form({ systemPrompt: "be terse", prompt: "hi" }));
    expect(body.messages).toEqual([
      { role: "system", content: "be terse" },
      { role: "user", content: "hi" },
    ]);
  });

  it("maps only the requirement fields the user set", () => {
    const body = buildCompletionRequest(
      form({
        prompt: "hi",
        minQualityTier: "high",
        maxLatencyMs: "2000",
        maxCostUsd: "0.05",
        capabilities: ["vision"],
      }),
    );
    expect(body.requirements).toEqual({
      requiredCapabilities: ["vision"],
      minQualityTier: "high",
      maxLatencyMs: 2000,
      maxCostUsd: "0.05",
    });
  });

  it("builds an override only when a provider or model is pinned", () => {
    expect(buildCompletionRequest(form({ prompt: "hi" })).override).toBeUndefined();
    expect(
      buildCompletionRequest(form({ prompt: "hi", overrideProviderId: "mock-cheap" })).override,
    ).toEqual({ providerId: "mock-cheap" });
    expect(
      buildCompletionRequest(
        form({ prompt: "hi", overrideProviderId: "mock-cheap", overrideModelId: "mock-cheap:small" }),
      ).override,
    ).toEqual({ providerId: "mock-cheap", modelId: "mock-cheap:small" });
  });
});
