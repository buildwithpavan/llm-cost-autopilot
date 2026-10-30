import { describe, expect, it } from "vitest";

import type { RoutingDecision } from "../src/types";
import { computeSavings } from "../src/features/playground/savings-model";

function candidate(
  providerId: string,
  modelId: string,
  included: boolean,
  estimatedCostUsd: string | null,
) {
  return { providerId, modelId, included, exclusionReason: null, scoreBreakdown: {}, estimatedCostUsd };
}

function decision(over: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    decisionSource: "autopilot",
    shadowedSource: null,
    chosenProviderId: "cheap",
    chosenModelId: "cheap:small",
    estimatedCostUsd: "0.10",
    pricingTableVersionId: "v",
    rationale: [],
    candidateRanking: [
      candidate("cheap", "cheap:small", true, "0.10"),
      candidate("premium", "premium:xl", true, "1.00"),
    ],
    ...over,
  };
}

describe("computeSavings", () => {
  it("uses the most expensive viable candidate as the baseline", () => {
    const s = computeSavings(decision());
    expect(s.comparable).toBe(true);
    expect(s.chosenCostUsd).toBe(0.1);
    expect(s.baselineCostUsd).toBe(1);
    expect(s.savingsUsd).toBeCloseTo(0.9, 10);
    expect(s.savingsPct).toBeCloseTo(90, 10);
    expect(s.baselineModelId).toBe("premium:xl");
  });

  it("ignores excluded candidates when picking the baseline", () => {
    const s = computeSavings(
      decision({
        candidateRanking: [
          candidate("cheap", "cheap:small", true, "0.10"),
          candidate("premium", "premium:xl", false, null),
        ],
      }),
    );
    expect(s.comparable).toBe(false);
    expect(s.savingsUsd).toBe(0);
  });

  it("reports non-comparable when only one priced candidate exists", () => {
    const s = computeSavings(
      decision({
        candidateRanking: [candidate("cheap", "cheap:small", true, "0.10")],
      }),
    );
    expect(s.comparable).toBe(false);
    expect(s.baselineCostUsd).toBe(s.chosenCostUsd);
  });

  it("never reports negative savings when the chosen model is the costliest", () => {
    const s = computeSavings(
      decision({
        chosenProviderId: "premium",
        chosenModelId: "premium:xl",
        estimatedCostUsd: "1.00",
      }),
    );
    expect(s.savingsUsd).toBe(0);
    expect(s.savingsPct).toBe(0);
  });
});
