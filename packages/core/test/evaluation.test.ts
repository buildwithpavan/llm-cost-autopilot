import { describe, expect, it } from "vitest";

import { estimateInputTokens } from "../src/evaluation/tokens.js";
import { filterCandidates } from "../src/evaluation/evaluate.js";
import type { Model, NormalizedRequest } from "../src/index.js";

const MODELS: readonly Model[] = [
  {
    modelId: "a:small",
    providerId: "a",
    capabilities: ["json_mode"],
    contextWindow: 100,
    qualityTier: "standard",
    publishedLatencyProfile: { p50Ms: 100, p95Ms: 200 },
    publishedReliabilityScore: 0.98,
    pricingDescriptorRef: "a:small",
  },
  {
    modelId: "b:tools",
    providerId: "b",
    capabilities: ["tool_use", "json_mode"],
    contextWindow: 10_000,
    qualityTier: "high",
    publishedLatencyProfile: { p50Ms: 500, p95Ms: 1_500 },
    publishedReliabilityScore: 0.99,
    pricingDescriptorRef: "b:tools",
  },
];

function mkReq(over: Partial<NormalizedRequest> = {}): NormalizedRequest {
  return {
    requestId: "01924b1a-4c9f-7000-b000-000000000001",
    clientId: "c",
    receivedAt: "2026-09-08T00:00:00.000Z",
    messages: [{ role: "user", content: "hi" }],
    requirements: { requiredCapabilities: [] },
    override: null,
    estimatedInputTokens: 50,
    ...over,
  };
}

describe("estimateInputTokens", () => {
  it("returns 0 for empty messages", () => {
    expect(estimateInputTokens([])).toBe(0);
  });

  it("grows with content length (heuristic)", () => {
    const small = estimateInputTokens([{ role: "user", content: "hi" }]);
    const large = estimateInputTokens([{ role: "user", content: "hi ".repeat(1_000) }]);
    expect(large).toBeGreaterThan(small);
  });
});

describe("filterCandidates", () => {
  it("keeps models that satisfy capability requirements", () => {
    const req = mkReq({ requirements: { requiredCapabilities: ["tool_use"] } });
    const kept = filterCandidates(req, MODELS);
    const included = kept.filter((c) => c.included).map((c) => c.modelId);
    expect(included).toEqual(["b:tools"]);
  });

  it("marks models with insufficient context window as excluded (FR-030 candidate step)", () => {
    const req = mkReq({ estimatedInputTokens: 500 });
    const kept = filterCandidates(req, MODELS);
    const a = kept.find((c) => c.modelId === "a:small");
    expect(a?.included).toBe(false);
    expect(a?.exclusionReason).toMatch(/context/i);
  });

  it("marks models exceeding latency ceiling as excluded", () => {
    const req = mkReq({ requirements: { maxLatencyMs: 300, requiredCapabilities: [] } });
    const kept = filterCandidates(req, MODELS);
    const b = kept.find((c) => c.modelId === "b:tools");
    expect(b?.included).toBe(false);
    expect(b?.exclusionReason).toMatch(/latency/i);
  });
});
