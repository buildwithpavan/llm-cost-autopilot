import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getOptimizationInsights,
  type OptimizationInsightsResponse,
} from "../src/lib/api/telemetry";

const payload: OptimizationInsightsResponse = {
  window: { since: "2026-10-01T00:00:00.000Z", until: "2026-10-03T00:00:00.000Z" },
  thresholds: {
    concentrationRatioThreshold: "0.40",
    minSpendUsd: "0.010000",
    budgetPressureRatioThreshold: "0.80",
    pricingComparisonMinDeltaUsd: "0.010000",
    maxPricingAlternatives: 1,
  },
  pricingTableVersionId: "seed-2026-09-08",
  insights: [
    {
      type: "pricing_comparison",
      id: "pricing_comparison:mock-fast:mock-fast:default:mock-cheap:mock-cheap:small",
      severity: "info",
      title: "Lower-priced catalog option for mock-fast:mock-fast:default",
      description: "A lower-priced catalog model exists for the observed token volume.",
      providerId: "mock-fast",
      modelId: "mock-fast:default",
      observedRequestCount: 3,
      observedInputTokens: 300_000,
      observedOutputTokens: 150_000,
      observedEstimatedCostUsd: "0.600000",
      currentPricedCostUsd: "0.6",
      alternativeProviderId: "mock-cheap",
      alternativeModelId: "mock-cheap:small",
      counterfactualEstimatedCostUsd: "0.06",
      costDifferenceUsd: "0.54",
      compatibilitySignal: "none",
      assumptions: ["price comparison only, not a routing recommendation"],
    },
  ],
};

describe("getOptimizationInsights wrapper", () => {
  afterEach(() => vi.restoreAllMocks());

  function mockFetch(body: OptimizationInsightsResponse) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
    );
  }

  it("requests GET /v1/telemetry/optimization-insights with filters and bearer key", async () => {
    const spy = mockFetch(payload);
    await getOptimizationInsights({
      since: "2026-10-01T00:00:00.000Z",
      until: "2026-10-03T00:00:00.000Z",
      providerId: "mock-fast",
      modelId: "mock-fast:default",
      clientId: "acme",
      apiKey: "secret-key",
    });
    const [url, init] = spy.mock.calls[0]!;
    const u = String(url);
    expect(u).toContain("/v1/telemetry/optimization-insights");
    expect(u).toContain("since=");
    expect(u).toContain("providerId=mock-fast");
    expect(u).toContain("modelId=mock-fast%3Adefault");
    expect(u).toContain("clientId=acme");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer secret-key");
  });

  it("preserves all monetary values as exact decimal strings (never Number)", async () => {
    mockFetch(payload);
    const res = await getOptimizationInsights();
    const insight = res.insights[0]!;
    if (insight.type !== "pricing_comparison") throw new Error("expected pricing_comparison");
    expect(insight.costDifferenceUsd).toBe("0.54");
    expect(insight.counterfactualEstimatedCostUsd).toBe("0.06");
    expect(insight.observedEstimatedCostUsd).toBe("0.600000");
    expect(typeof insight.costDifferenceUsd).toBe("string");
    expect(res.thresholds.concentrationRatioThreshold).toBe("0.40");
  });
});
