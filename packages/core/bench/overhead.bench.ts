import { bench, describe } from "vitest";

import { estimateInputTokens } from "../src/evaluation/tokens.js";
import { decideRoute } from "../src/routing/decide.js";
import type { Model, NormalizedRequest, PricingTable } from "../src/index.js";

const PRICING: PricingTable = {
  versionId: "bench-v1",
  effectiveFrom: "2026-09-08T00:00:00.000Z",
  entries: [
    { providerId: "cheap", modelId: "cheap:small", unitInputUsdPerToken: "0.0000001", unitOutputUsdPerToken: "0.0000002", currency: "USD" },
    { providerId: "cheap", modelId: "cheap:large", unitInputUsdPerToken: "0.0000005", unitOutputUsdPerToken: "0.000001", currency: "USD" },
    { providerId: "fast", modelId: "fast:default", unitInputUsdPerToken: "0.000001", unitOutputUsdPerToken: "0.000002", currency: "USD" },
    { providerId: "premium", modelId: "premium:xl", unitInputUsdPerToken: "0.00001", unitOutputUsdPerToken: "0.00003", currency: "USD" },
  ],
};

const CATALOG: Model[] = [
  {
    modelId: "cheap:small", providerId: "cheap", capabilities: ["json_mode"],
    contextWindow: 8_000, qualityTier: "standard",
    publishedLatencyProfile: { p50Ms: 200, p95Ms: 500 },
    publishedReliabilityScore: 0.98, pricingDescriptorRef: "cheap:small",
  },
  {
    modelId: "cheap:large", providerId: "cheap", capabilities: ["json_mode", "tool_use"],
    contextWindow: 32_000, qualityTier: "high",
    publishedLatencyProfile: { p50Ms: 400, p95Ms: 900 },
    publishedReliabilityScore: 0.99, pricingDescriptorRef: "cheap:large",
  },
  {
    modelId: "fast:default", providerId: "fast", capabilities: ["json_mode", "function_calling"],
    contextWindow: 16_000, qualityTier: "standard",
    publishedLatencyProfile: { p50Ms: 40, p95Ms: 120 },
    publishedReliabilityScore: 0.97, pricingDescriptorRef: "fast:default",
  },
  {
    modelId: "premium:xl", providerId: "premium",
    capabilities: ["json_mode", "tool_use", "function_calling", "vision"],
    contextWindow: 128_000, qualityTier: "high",
    publishedLatencyProfile: { p50Ms: 700, p95Ms: 2_000 },
    publishedReliabilityScore: 0.995, pricingDescriptorRef: "premium:xl",
  },
];

function mkRequest(): NormalizedRequest {
  return {
    requestId: "01924b1a-4c9f-7000-b000-000000000001",
    clientId: "bench",
    receivedAt: "2026-09-08T00:00:00.000Z",
    messages: [{ role: "user", content: "hi ".repeat(50) }],
    requirements: { requiredCapabilities: [] },
    override: null,
    estimatedInputTokens: 50,
  };
}

describe("routing pipeline overhead (T097 / SC-007)", () => {
  const request = mkRequest();
  bench("decideRoute over 4-model catalog", () => {
    decideRoute({ request, catalog: CATALOG, pricingTable: PRICING });
  });

  bench("estimateInputTokens over ~150-char message", () => {
    estimateInputTokens(request.messages);
  });

  bench("full pipeline: estimate + decide", () => {
    const est = estimateInputTokens(request.messages);
    decideRoute({
      request: { ...request, estimatedInputTokens: est },
      catalog: CATALOG,
      pricingTable: PRICING,
    });
  });
});
