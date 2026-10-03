import { describe, expect, it } from "vitest";

import { generateOptimizationInsights } from "../src/insights/optimization.js";
import type {
  GenerateOptimizationInsightsInput,
  OptimizationConfig,
  PricingComparisonInsight,
} from "../src/insights/types.js";
import { ratioUsd } from "../src/cost/estimate.js";
import type { Model, PricingTable } from "../src/types/catalog.js";

const CONFIG: OptimizationConfig = {
  concentrationRatioThreshold: "0.40",
  minSpendUsd: "0.010000",
  budgetPressureRatioThreshold: "0.80",
  pricingComparisonMinDeltaUsd: "0.010000",
  maxPricingAlternatives: 1,
};

const PRICING: PricingTable = {
  versionId: "seed-2026-09-08",
  effectiveFrom: "2026-09-08T00:00:00.000Z",
  entries: [
    { providerId: "cheap", modelId: "cheap:s", unitInputUsdPerToken: "0.0000001", unitOutputUsdPerToken: "0.0000002", currency: "USD" },
    { providerId: "mid", modelId: "mid:m", unitInputUsdPerToken: "0.0000003", unitOutputUsdPerToken: "0.0000006", currency: "USD" },
    { providerId: "prem", modelId: "prem:l", unitInputUsdPerToken: "0.000001", unitOutputUsdPerToken: "0.000002", currency: "USD" },
  ],
};

function model(providerId: string, modelId: string, caps: Model["capabilities"], ctx: number, tier: Model["qualityTier"]): Model {
  return {
    modelId,
    providerId,
    capabilities: caps,
    contextWindow: ctx,
    qualityTier: tier,
    publishedLatencyProfile: { p50Ms: 100, p95Ms: 300 },
    publishedReliabilityScore: 0.99,
    pricingDescriptorRef: modelId,
  };
}

const CATALOG: Model[] = [
  model("cheap", "cheap:s", ["json_mode"], 8_000, "standard"),
  model("mid", "mid:m", ["json_mode", "tool_use"], 16_000, "high"),
  model("prem", "prem:l", ["json_mode"], 32_000, "high"),
];

function baseInput(overrides: Partial<GenerateOptimizationInsightsInput> = {}): GenerateOptimizationInsightsInput {
  return {
    totalEstimatedCostUsd: "2.040000",
    byModel: [
      { providerId: "prem", modelId: "prem:l", requestCount: 100, inputTokens: 1_000_000, outputTokens: 500_000, estimatedCostUsd: "2.000000" },
      { providerId: "cheap", modelId: "cheap:s", requestCount: 50, inputTokens: 200_000, outputTokens: 100_000, estimatedCostUsd: "0.040000" },
    ],
    catalog: CATALOG,
    pricingTable: PRICING,
    budgets: [],
    config: CONFIG,
    ...overrides,
  };
}

describe("ratioUsd", () => {
  it("computes an exact 6-dp ratio", () => {
    expect(ratioUsd("2.000000", "2.040000")).toBe("0.980392");
    expect(ratioUsd("0.040000", "2.040000")).toBe("0.019608");
  });
  it("returns zero when the denominator is zero", () => {
    expect(ratioUsd("1.000000", "0")).toBe("0.000000");
  });
});

describe("generateOptimizationInsights — cost concentration", () => {
  it("flags a model above the concentration threshold with an exact share ratio", () => {
    const insights = generateOptimizationInsights(baseInput());
    const conc = insights.filter((i) => i.type === "cost_concentration");
    expect(conc).toHaveLength(1);
    const c = conc[0]!;
    expect(c.type).toBe("cost_concentration");
    if (c.type !== "cost_concentration") return;
    expect(c.providerId).toBe("prem");
    expect(c.modelId).toBe("prem:l");
    expect(c.shareRatio).toBe("0.980392"); // exact, preserved as string
    expect(c.estimatedCostUsd).toBe("2.000000");
    expect(c.severity).toBe("warning");
  });

  it("ignores models below the minimum-spend floor", () => {
    const insights = generateOptimizationInsights(
      baseInput({
        totalEstimatedCostUsd: "0.005000",
        byModel: [
          { providerId: "cheap", modelId: "cheap:s", requestCount: 1, inputTokens: 10, outputTokens: 5, estimatedCostUsd: "0.005000" },
        ],
      }),
    );
    expect(insights.filter((i) => i.type === "cost_concentration")).toHaveLength(0);
  });
});

describe("generateOptimizationInsights — pricing comparison", () => {
  it("produces an exact counterfactual and cost difference for a cheaper priced alternative", () => {
    const insights = generateOptimizationInsights(baseInput());
    const pricing = insights.filter(
      (i): i is PricingComparisonInsight => i.type === "pricing_comparison",
    );
    // Observed prem:l (cost 2.0); cheapest priced alternative is cheap:s (0.2).
    const forPrem = pricing.find((p) => p.providerId === "prem");
    expect(forPrem).toBeDefined();
    expect(forPrem!.alternativeProviderId).toBe("cheap");
    expect(forPrem!.alternativeModelId).toBe("cheap:s");
    expect(forPrem!.currentPricedCostUsd).toBe("2"); // 1e6*1e-6 + 5e5*2e-6 = 2
    expect(forPrem!.counterfactualEstimatedCostUsd).toBe("0.2"); // 1e6*1e-7 + 5e5*2e-7
    expect(forPrem!.costDifferenceUsd).toBe("1.8");
    expect(forPrem!.severity).toBe("info");
  });

  it("labels an alternative with weaker catalog metadata as no-compatibility and never a routing claim", () => {
    const insights = generateOptimizationInsights(baseInput());
    const forPrem = insights.find(
      (i): i is PricingComparisonInsight => i.type === "pricing_comparison" && i.providerId === "prem",
    );
    expect(forPrem!.compatibilitySignal).toBe("none"); // cheap:s context window 8k < 32k
    // Advisory language only — never imperative routing directives.
    const text = `${forPrem!.title} ${forPrem!.description}`.toLowerCase();
    for (const word of ["switch", "replace", "should", "must route", "best", "optimal"]) {
      expect(text).not.toContain(word);
    }
    expect(forPrem!.assumptions.some((a) => a.includes("not a routing"))).toBe(true);
  });

  it("emits catalog_superset only when the alternative meets or exceeds caps, context, and quality", () => {
    const catalog: Model[] = [
      model("pricey", "pricey:x", ["json_mode"], 8_000, "standard"),
      model("value", "value:y", ["json_mode", "tool_use"], 16_000, "high"),
    ];
    const pricing: PricingTable = {
      versionId: "v",
      effectiveFrom: "2026-09-08T00:00:00.000Z",
      entries: [
        { providerId: "pricey", modelId: "pricey:x", unitInputUsdPerToken: "0.000001", unitOutputUsdPerToken: "0.000002", currency: "USD" },
        { providerId: "value", modelId: "value:y", unitInputUsdPerToken: "0.0000001", unitOutputUsdPerToken: "0.0000002", currency: "USD" },
      ],
    };
    const insights = generateOptimizationInsights(
      baseInput({
        totalEstimatedCostUsd: "2.000000",
        byModel: [
          { providerId: "pricey", modelId: "pricey:x", requestCount: 10, inputTokens: 1_000_000, outputTokens: 500_000, estimatedCostUsd: "2.000000" },
        ],
        catalog,
        pricingTable: pricing,
      }),
    );
    const forPricey = insights.find(
      (i): i is PricingComparisonInsight => i.type === "pricing_comparison" && i.providerId === "pricey",
    );
    expect(forPricey!.compatibilitySignal).toBe("catalog_superset");
    expect(forPricey!.assumptions.some((a) => a.includes("catalog signal"))).toBe(true);
  });

  it("respects the maxPricingAlternatives bound", () => {
    const insights = generateOptimizationInsights(
      baseInput({ config: { ...CONFIG, maxPricingAlternatives: 0 } }),
    );
    expect(insights.filter((i) => i.type === "pricing_comparison")).toHaveLength(0);
  });
});

describe("generateOptimizationInsights — budget pressure", () => {
  it("maps over-limit to critical and approaching to warning; ignores healthy budgets", () => {
    const insights = generateOptimizationInsights(
      baseInput({
        totalEstimatedCostUsd: "0",
        byModel: [],
        budgets: [
          { budgetId: "over", scope: "global", clientId: null, period: "daily", action: "block", limitUsd: "10.000000", currentSpendUsd: "12.000000", remainingUsd: "-2.000000", utilization: "1.200000", status: "over_limit" },
          { budgetId: "near", scope: "client", clientId: "acme", period: "daily", action: "warn", limitUsd: "10.000000", currentSpendUsd: "8.500000", remainingUsd: "1.500000", utilization: "0.850000", status: "below_limit" },
          { budgetId: "ok", scope: "global", clientId: null, period: "rolling_30d", action: "warn", limitUsd: "10.000000", currentSpendUsd: "5.000000", remainingUsd: "5.000000", utilization: "0.500000", status: "below_limit" },
        ],
      }),
    );
    const pressure = insights.filter((i) => i.type === "budget_pressure");
    expect(pressure.map((p) => p.id)).toEqual(["budget_pressure:over", "budget_pressure:near"]);
    expect(pressure.find((p) => p.id === "budget_pressure:over")!.severity).toBe("critical");
    expect(pressure.find((p) => p.id === "budget_pressure:near")!.severity).toBe("warning");
  });
});

describe("generateOptimizationInsights — ordering & empties", () => {
  it("orders by severity, then exact financial magnitude, then stable id", () => {
    const insights = generateOptimizationInsights(
      baseInput({
        budgets: [
          { budgetId: "over", scope: "global", clientId: null, period: "daily", action: "block", limitUsd: "10.000000", currentSpendUsd: "12.000000", remainingUsd: "-2.000000", utilization: "1.200000", status: "over_limit" },
          { budgetId: "near", scope: "client", clientId: "acme", period: "daily", action: "warn", limitUsd: "10.000000", currentSpendUsd: "8.500000", remainingUsd: "1.500000", utilization: "0.850000", status: "below_limit" },
        ],
      }),
    );
    // critical (budget over) → warnings by magnitude (budget near 8.5 > concentration 2.0) → info (pricing)
    expect(insights.map((i) => i.type)).toEqual([
      "budget_pressure",
      "budget_pressure",
      "cost_concentration",
      "pricing_comparison",
    ]);
    expect(insights[0]!.severity).toBe("critical");
  });

  it("returns an empty list when there is no spend and no budgets", () => {
    const insights = generateOptimizationInsights(
      baseInput({ totalEstimatedCostUsd: "0", byModel: [], budgets: [] }),
    );
    expect(insights).toEqual([]);
  });

  it("is deterministic across repeated invocations", () => {
    const a = generateOptimizationInsights(baseInput());
    const b = generateOptimizationInsights(baseInput());
    expect(a).toEqual(b);
  });
});
