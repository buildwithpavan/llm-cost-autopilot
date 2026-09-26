import { describe, expect, it } from "vitest";
import type { PreviewFormState } from "../src/features/preview/preview-form";
import {
  CAPABILITIES,
  buildPreviewRequest,
  emptyPreviewForm,
  hasErrors,
  toggleCapability,
  validatePreviewForm,
} from "../src/features/preview/preview-form";

function form(over: Partial<PreviewFormState>): PreviewFormState {
  return { ...emptyPreviewForm(), ...over };
}

describe("validatePreviewForm", () => {
  it("accepts a minimal valid prompt", () => {
    expect(hasErrors(validatePreviewForm(form({ prompt: "hello" })))).toBe(false);
  });

  it("rejects a blank/whitespace prompt", () => {
    expect(validatePreviewForm(form({ prompt: "" })).prompt).toBeDefined();
    expect(validatePreviewForm(form({ prompt: "   " })).prompt).toBeDefined();
  });

  it("accepts a positive integer max latency and rejects invalid ones", () => {
    expect(validatePreviewForm(form({ prompt: "x", maxLatencyMs: "250" })).maxLatencyMs).toBeUndefined();
    expect(validatePreviewForm(form({ prompt: "x", maxLatencyMs: "0" })).maxLatencyMs).toBeDefined();
    expect(validatePreviewForm(form({ prompt: "x", maxLatencyMs: "-5" })).maxLatencyMs).toBeDefined();
    expect(validatePreviewForm(form({ prompt: "x", maxLatencyMs: "12.5" })).maxLatencyMs).toBeDefined();
    expect(validatePreviewForm(form({ prompt: "x", maxLatencyMs: "abc" })).maxLatencyMs).toBeDefined();
  });

  it("accepts a valid decimal max cost and rejects invalid ones", () => {
    expect(validatePreviewForm(form({ prompt: "x", maxCostUsd: "0.01" })).maxCostUsd).toBeUndefined();
    expect(validatePreviewForm(form({ prompt: "x", maxCostUsd: "5" })).maxCostUsd).toBeUndefined();
    expect(validatePreviewForm(form({ prompt: "x", maxCostUsd: "0.000001" })).maxCostUsd).toBeUndefined();
    expect(validatePreviewForm(form({ prompt: "x", maxCostUsd: "-1" })).maxCostUsd).toBeDefined();
    expect(validatePreviewForm(form({ prompt: "x", maxCostUsd: "1.2.3" })).maxCostUsd).toBeDefined();
    expect(validatePreviewForm(form({ prompt: "x", maxCostUsd: "abc" })).maxCostUsd).toBeDefined();
  });
});

describe("toggleCapability", () => {
  it("adds then removes a capability and only exposes the known enum", () => {
    expect(toggleCapability([], "vision")).toEqual(["vision"]);
    expect(toggleCapability(["vision"], "vision")).toEqual([]);
    expect(CAPABILITIES).toEqual(["tool_use", "json_mode", "function_calling", "vision"]);
  });
});

describe("buildPreviewRequest", () => {
  it("builds a single user message from the trimmed prompt", () => {
    expect(buildPreviewRequest(form({ prompt: "  route this  " }))).toEqual({
      messages: [{ role: "user", content: "route this" }],
    });
  });

  it("omits requirements entirely when none are set", () => {
    const req = buildPreviewRequest(form({ prompt: "x" }));
    expect(req).not.toHaveProperty("requirements");
    expect(req).not.toHaveProperty("override");
  });

  it("never produces an override — Preview evaluates autonomous routing only", () => {
    // The preview backend ignores overrides, so the UI must never send one.
    for (const state of [
      form({ prompt: "x" }),
      form({ prompt: "x", capabilities: ["tool_use"], minQualityTier: "high", maxLatencyMs: "500", maxCostUsd: "0.05" }),
    ]) {
      expect(buildPreviewRequest(state)).not.toHaveProperty("override");
    }
  });

  it("includes selected capabilities and quality tier", () => {
    const req = buildPreviewRequest(form({ prompt: "x", capabilities: ["tool_use", "vision"], minQualityTier: "high" }));
    expect(req.requirements?.requiredCapabilities).toEqual(["tool_use", "vision"]);
    expect(req.requirements?.minQualityTier).toBe("high");
  });

  it("omits empty capabilities (no empty array fabricated)", () => {
    const req = buildPreviewRequest(form({ prompt: "x", minQualityTier: "low" }));
    expect(req.requirements).toEqual({ minQualityTier: "low" });
    expect(req.requirements).not.toHaveProperty("requiredCapabilities");
  });

  it("passes max latency as a number and max cost as a decimal string", () => {
    const req = buildPreviewRequest(form({ prompt: "x", maxLatencyMs: "300", maxCostUsd: "0.02" }));
    expect(req.requirements?.maxLatencyMs).toBe(300);
    expect(req.requirements?.maxCostUsd).toBe("0.02");
    expect(typeof req.requirements?.maxCostUsd).toBe("string");
  });

  it("produces a request shape matching the backend contract", () => {
    const req = buildPreviewRequest(
      form({
        prompt: "summarize",
        capabilities: ["json_mode"],
        minQualityTier: "standard",
        maxLatencyMs: "500",
        maxCostUsd: "0.10",
      }),
    );
    expect(req).toEqual({
      messages: [{ role: "user", content: "summarize" }],
      requirements: {
        requiredCapabilities: ["json_mode"],
        minQualityTier: "standard",
        maxLatencyMs: 500,
        maxCostUsd: "0.10",
      },
    });
    expect(req).not.toHaveProperty("override");
  });
});
