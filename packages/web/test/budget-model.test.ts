import { describe, expect, it } from "vitest";

import {
  budgetActionLabel,
  budgetPeriodLabel,
  budgetScopeLabel,
  budgetStatusTone,
  formatUtilizationPercent,
  utilizationTrackValue,
} from "../src/features/cost/budget-model";

describe("formatUtilizationPercent", () => {
  it("renders a 6-decimal ratio string as a 1-decimal percentage", () => {
    expect(formatUtilizationPercent("0.250000")).toBe("25.0%");
    expect(formatUtilizationPercent("1.000000")).toBe("100.0%");
    expect(formatUtilizationPercent("1.250000")).toBe("125.0%");
    expect(formatUtilizationPercent("0.333333")).toBe("33.3%");
    expect(formatUtilizationPercent("0")).toBe("0.0%");
  });

  it("returns a dash for a malformed value", () => {
    expect(formatUtilizationPercent("abc")).toBe("—");
  });
});

describe("budgetStatusTone", () => {
  it("maps each backend status to a distinct descriptive tone", () => {
    expect(budgetStatusTone("below_limit").label).toBe("within budget");
    expect(budgetStatusTone("at_limit").label).toBe("at limit");
    expect(budgetStatusTone("over_limit").label).toBe("over budget");
    expect(budgetStatusTone("below_limit").color).not.toBe(budgetStatusTone("over_limit").color);
  });
});

describe("scope / period / action labels", () => {
  it("renders global vs client scope (with client id when present)", () => {
    expect(budgetScopeLabel({ scope: "global", clientId: null })).toBe("Global");
    expect(budgetScopeLabel({ scope: "client", clientId: "acme" })).toBe("Client · acme");
    expect(budgetScopeLabel({ scope: "client", clientId: null })).toBe("Client");
  });

  it("renders period labels", () => {
    expect(budgetPeriodLabel("daily")).toBe("Daily");
    expect(budgetPeriodLabel("rolling_30d")).toBe("Rolling 30d");
  });

  it("renders action labels", () => {
    expect(budgetActionLabel("block")).toBe("Block");
    expect(budgetActionLabel("warn")).toBe("Warn");
  });
});

describe("utilizationTrackValue", () => {
  it("returns a [0,1] fraction, clamping over-budget to 1", () => {
    expect(utilizationTrackValue("0.500000")).toBe(0.5);
    expect(utilizationTrackValue("0")).toBe(0);
    expect(utilizationTrackValue("2.000000")).toBe(1);
  });
});
