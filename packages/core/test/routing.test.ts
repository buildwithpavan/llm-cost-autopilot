import { describe, expect, it } from "vitest";

import type { Model, NormalizedRequest, PricingTable } from "../src/index.js";
import { decideRoute } from "../src/routing/decide.js";

const PRICING: PricingTable = {
  versionId: "test",
  effectiveFrom: "2026-09-08T00:00:00.000Z",
  entries: [
    {
      providerId: "cheap",
      modelId: "cheap:small",
      unitInputUsdPerToken: "0.0000001",
      unitOutputUsdPerToken: "0.0000002",
      currency: "USD",
    },
    {
      providerId: "fast",
      modelId: "fast:default",
      unitInputUsdPerToken: "0.000001",
      unitOutputUsdPerToken: "0.000002",
      currency: "USD",
    },
    {
      providerId: "premium",
      modelId: "premium:xl",
      unitInputUsdPerToken: "0.00001",
      unitOutputUsdPerToken: "0.00003",
      currency: "USD",
    },
  ],
};

const MODELS: readonly Model[] = [
  {
    modelId: "cheap:small",
    providerId: "cheap",
    capabilities: ["json_mode"],
    contextWindow: 8_000,
    qualityTier: "standard",
    publishedLatencyProfile: { p50Ms: 200, p95Ms: 500 },
    publishedReliabilityScore: 0.98,
    pricingDescriptorRef: "cheap:small",
  },
  {
    modelId: "fast:default",
    providerId: "fast",
    capabilities: ["json_mode", "function_calling"],
    contextWindow: 16_000,
    qualityTier: "standard",
    publishedLatencyProfile: { p50Ms: 40, p95Ms: 120 },
    publishedReliabilityScore: 0.97,
    pricingDescriptorRef: "fast:default",
  },
  {
    modelId: "premium:xl",
    providerId: "premium",
    capabilities: ["json_mode", "tool_use", "function_calling", "vision"],
    contextWindow: 128_000,
    qualityTier: "high",
    publishedLatencyProfile: { p50Ms: 700, p95Ms: 2_000 },
    publishedReliabilityScore: 0.995,
    pricingDescriptorRef: "premium:xl",
  },
];

function mkReq(partial: Partial<NormalizedRequest> = {}): NormalizedRequest {
  return {
    requestId: "01924b1a-4c9f-7000-b000-000000000001",
    clientId: "c",
    receivedAt: "2026-09-08T00:00:00.000Z",
    messages: [{ role: "user", content: "hi" }],
    requirements: { requiredCapabilities: [] },
    override: null,
    estimatedInputTokens: 100,
    ...partial,
  };
}

describe("deterministic routing", () => {
  it("picks the lowest-cost candidate when no requirements are set", () => {
    const decision = decideRoute({
      request: mkReq(),
      catalog: MODELS,
      pricingTable: PRICING,
    });
    expect(decision.chosenProviderId).toBe("cheap");
    expect(decision.chosenModelId).toBe("cheap:small");
    expect(decision.decisionSource).toBe("autopilot");
  });

  it("excludes models whose published p95 latency exceeds the ceiling", () => {
    const decision = decideRoute({
      request: mkReq({ requirements: { requiredCapabilities: [], maxLatencyMs: 200 } }),
      catalog: MODELS,
      pricingTable: PRICING,
    });
    const excluded = decision.candidateRanking.find((c) => c.modelId === "premium:xl");
    expect(excluded?.included).toBe(false);
    expect(decision.chosenModelId).not.toBe("premium:xl");
  });

  it("forces a specific provider when a required capability is unique to it", () => {
    const decision = decideRoute({
      request: mkReq({ requirements: { requiredCapabilities: ["tool_use"] } }),
      catalog: MODELS,
      pricingTable: PRICING,
    });
    expect(decision.chosenProviderId).toBe("premium");
  });

  it("is deterministic: identical inputs yield identical decisions (FR-011)", () => {
    const a = decideRoute({ request: mkReq(), catalog: MODELS, pricingTable: PRICING });
    const b = decideRoute({ request: mkReq(), catalog: MODELS, pricingTable: PRICING });
    expect(a.chosenModelId).toBe(b.chosenModelId);
    expect(a.chosenProviderId).toBe(b.chosenProviderId);
    expect(a.candidateRanking).toEqual(b.candidateRanking);
  });

  it("rejects when estimated tokens exceed every candidate context window (FR-030)", () => {
    expect(() =>
      decideRoute({
        request: mkReq({ estimatedInputTokens: 999_999 }),
        catalog: MODELS,
        pricingTable: PRICING,
      }),
    ).toThrow(/context/i);
  });

  it("produces a machine-readable rationale with per-factor verdicts (FR-012)", () => {
    const decision = decideRoute({ request: mkReq(), catalog: MODELS, pricingTable: PRICING });
    expect(decision.rationale.length).toBeGreaterThan(0);
    expect(decision.rationale.every((r) => typeof r.factor === "string")).toBe(true);
  });

  it("applies deterministic tiebreaker when candidates score equally (FR-031)", () => {
    const evenModels: Model[] = [
      { ...MODELS[0], modelId: "twin:a", providerId: "twin", pricingDescriptorRef: "twin:a" },
      { ...MODELS[0], modelId: "twin:b", providerId: "twin", pricingDescriptorRef: "twin:b" },
    ];
    const pricing: PricingTable = {
      ...PRICING,
      entries: [
        {
          providerId: "twin",
          modelId: "twin:a",
          unitInputUsdPerToken: "0.0000001",
          unitOutputUsdPerToken: "0.0000002",
          currency: "USD",
        },
        {
          providerId: "twin",
          modelId: "twin:b",
          unitInputUsdPerToken: "0.0000001",
          unitOutputUsdPerToken: "0.0000002",
          currency: "USD",
        },
      ],
    };
    const decision = decideRoute({ request: mkReq(), catalog: evenModels, pricingTable: pricing });
    // Tiebreaker: alphabetical by modelId.
    expect(decision.chosenModelId).toBe("twin:a");
  });
});
