import { describe, expect, it } from "vitest";

import type {
  BudgetPressureInsight,
  CostConcentrationInsight,
  PricingComparisonInsight,
} from "../src/lib/api/telemetry";
import { presentInsight, insightAriaLabel } from "../src/features/cost/insights-model";

const concentration: CostConcentrationInsight = {
  type: "cost_concentration",
  id: "cost_concentration:mock-fast:mock-fast:default",
  severity: "warning",
  title: "Observed spend concentrated in mock-fast:mock-fast:default",
  description: "mock-fast:default accounts for a large share of estimated spend.",
  providerId: "mock-fast",
  modelId: "mock-fast:default",
  estimatedCostUsd: "0.600000",
  totalEstimatedCostUsd: "0.600300",
  shareRatio: "0.999500",
  requestCount: 3,
};

const pricing: PricingComparisonInsight = {
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
  assumptions: ["Price comparison only, not a routing recommendation."],
};

const budget: BudgetPressureInsight = {
  type: "budget_pressure",
  id: "budget_pressure:b1",
  severity: "critical",
  title: "Budget is over its configured limit",
  description: "The configured client budget has consumed 0.600300 of 0.100000 USD.",
  budgetId: "b1",
  scope: "client",
  clientId: "acme",
  period: "daily",
  action: "block",
  limitUsd: "0.100000",
  currentSpendUsd: "0.600300",
  remainingUsd: "-0.500300",
  utilization: "6.003000",
  status: "over_limit",
};

describe("presentInsight — cost concentration", () => {
  it("labels the type and renders the share as a percentage, preserving the raw ratio", () => {
    const row = presentInsight(concentration);
    expect(row.typeLabel).toBe("Cost concentration");
    expect(row.severityLabel).toBe("Warning");
    expect(row.subject).toBe("mock-fast:mock-fast:default");
    expect(row.magnitudeLabel).toBe("Share of window spend");
    expect(row.magnitudeDisplay).toBe("100.0%"); // 0.999500 → 100.0% (1-dp)
    expect(row.isPricingComparison).toBe(false);
    expect(row.simulateHref).toBeNull();
  });
});

describe("presentInsight — pricing comparison", () => {
  it("marks the comparison, exposes assumptions, and builds a non-mutating simulation deep-link", () => {
    const row = presentInsight(pricing);
    expect(row.typeLabel).toBe("Pricing comparison");
    expect(row.severityLabel).toBe("Info");
    expect(row.magnitudeLabel).toBe("Potential cost difference");
    expect(row.isPricingComparison).toBe(true);
    expect(row.compatibilityLabel).toContain("Price-only comparison");
    expect(row.assumptions).toEqual(["Price comparison only, not a routing recommendation."]);
    expect(row.simulateHref).toBe("/routing/preview?pinProviderId=mock-cheap&pinModelId=mock-cheap%3Asmall");
    // No imperative routing language.
    const text = `${row.title} ${row.description}`.toLowerCase();
    for (const w of ["switch", "replace", "you should", "best", "optimal"]) {
      expect(text).not.toContain(w);
    }
    // Detail values format at the boundary but never mutate source strings.
    const altDetail = row.details.find((d) => d.label === "Alternative priced cost");
    expect(altDetail?.value).toContain("$");
    expect(pricing.counterfactualEstimatedCostUsd).toBe("0.06");
  });
});

describe("presentInsight — budget pressure", () => {
  it("labels severity and renders utilization as a percentage", () => {
    const row = presentInsight(budget);
    expect(row.typeLabel).toBe("Budget pressure");
    expect(row.severityLabel).toBe("Critical");
    expect(row.subject).toBe("Client budget · acme");
    expect(row.magnitudeLabel).toBe("Budget utilization");
    expect(row.magnitudeDisplay).toBe("600.3%");
    expect(row.simulateHref).toBeNull();
  });

  it("produces a color-independent accessible label", () => {
    expect(insightAriaLabel(presentInsight(budget))).toBe(
      "Critical budget pressure, Client budget · acme, Budget utilization 600.3%",
    );
  });
});
