import { describe, expect, it } from "vitest";

import { evaluateBudget } from "../src/budgets/evaluate.js";
import { budgetWindow } from "../src/budgets/window.js";
import { budgetInputSchema } from "../src/types/budget.js";

describe("evaluateBudget", () => {
  it("allows when projected spend is strictly below the limit", () => {
    const r = evaluateBudget({
      currentSpendUsd: "4.000000",
      requestEstimatedCostUsd: "1.000000",
      limitUsd: "10.000000",
      action: "block",
    });
    expect(r.decision).toBe("allow");
    expect(r.projectedSpendUsd).toBe("5.000000");
    expect(r.remainingUsd).toBe("5.000000");
    expect(r.overBudget).toBe(false);
  });

  it("blocks when projected spend exactly reaches the limit (action=block)", () => {
    const r = evaluateBudget({
      currentSpendUsd: "9.000000",
      requestEstimatedCostUsd: "1.000000",
      limitUsd: "10.000000",
      action: "block",
    });
    expect(r.decision).toBe("block");
    expect(r.overBudget).toBe(true);
    expect(r.remainingUsd).toBe("0.000000");
  });

  it("blocks when projected spend exceeds the limit (action=block)", () => {
    const r = evaluateBudget({
      currentSpendUsd: "9.500000",
      requestEstimatedCostUsd: "1.000000",
      limitUsd: "10.000000",
      action: "block",
    });
    expect(r.decision).toBe("block");
    expect(r.remainingUsd).toBe("-0.500000");
  });

  it("warns (but allows) when projected spend exactly reaches the limit (action=warn)", () => {
    const r = evaluateBudget({
      currentSpendUsd: "9.000000",
      requestEstimatedCostUsd: "1.000000",
      limitUsd: "10.000000",
      action: "warn",
    });
    expect(r.decision).toBe("warn");
    expect(r.overBudget).toBe(true);
    expect(r.remainingUsd).toBe("0.000000");
  });

  it("warns (but allows) when projected spend exceeds the limit (action=warn)", () => {
    const r = evaluateBudget({
      currentSpendUsd: "20.000000",
      requestEstimatedCostUsd: "5.000000",
      limitUsd: "10.000000",
      action: "warn",
    });
    expect(r.decision).toBe("warn");
    expect(r.remainingUsd).toBe("-15.000000");
  });

  it("reports zero remaining explicitly at the limit", () => {
    const r = evaluateBudget({
      currentSpendUsd: "10.000000",
      requestEstimatedCostUsd: "0.000000",
      limitUsd: "10.000000",
      action: "warn",
    });
    expect(r.remainingUsd).toBe("0.000000");
    expect(r.overBudget).toBe(true);
  });

  it("reports negative remaining explicitly without clamping", () => {
    const r = evaluateBudget({
      currentSpendUsd: "12.345678",
      requestEstimatedCostUsd: "0.000001",
      limitUsd: "1.000000",
      action: "block",
    });
    expect(r.remainingUsd).toBe("-11.345679");
    expect(r.decision).toBe("block");
  });

  it("uses exact decimal arithmetic (no IEEE-754 drift)", () => {
    // 0.1 + 0.2 !== 0.3 in floating point; Decimal is exact.
    const r = evaluateBudget({
      currentSpendUsd: "0.100000",
      requestEstimatedCostUsd: "0.200000",
      limitUsd: "0.300000",
      action: "block",
    });
    expect(r.projectedSpendUsd).toBe("0.300000");
    // projected == limit → over budget → block.
    expect(r.decision).toBe("block");
    expect(r.remainingUsd).toBe("0.000000");
  });

  it("accumulates many sub-cent values exactly", () => {
    let current = "0.000000";
    for (let i = 0; i < 1000; i++) {
      const r = evaluateBudget({
        currentSpendUsd: current,
        requestEstimatedCostUsd: "0.000001",
        limitUsd: "1.000000",
        action: "warn",
      });
      current = r.projectedSpendUsd;
    }
    expect(current).toBe("0.001000");
  });

  it("is deterministic for identical inputs", () => {
    const input = {
      currentSpendUsd: "1.250000",
      requestEstimatedCostUsd: "0.750000",
      limitUsd: "3.000000",
      action: "block" as const,
    };
    expect(evaluateBudget(input)).toEqual(evaluateBudget(input));
  });
});

describe("budgetInputSchema validation", () => {
  it("rejects a non-positive limit", () => {
    expect(() =>
      budgetInputSchema.parse({ scope: "global", clientId: null, period: "daily", limitUsd: "0", action: "block" }),
    ).toThrow();
    expect(() =>
      budgetInputSchema.parse({ scope: "global", clientId: null, period: "daily", limitUsd: "-1.000000", action: "block" }),
    ).toThrow();
  });

  it("rejects a global budget that carries a clientId", () => {
    expect(() =>
      budgetInputSchema.parse({ scope: "global", clientId: "acme", period: "daily", limitUsd: "10", action: "block" }),
    ).toThrow();
  });

  it("rejects a client budget without a clientId", () => {
    expect(() =>
      budgetInputSchema.parse({ scope: "client", clientId: null, period: "daily", limitUsd: "10", action: "block" }),
    ).toThrow();
  });

  it("accepts a valid global and client budget", () => {
    expect(
      budgetInputSchema.parse({ scope: "global", period: "rolling_30d", limitUsd: "100.500000", action: "warn" }).clientId,
    ).toBeNull();
    expect(
      budgetInputSchema.parse({ scope: "client", clientId: "acme", period: "daily", limitUsd: "5", action: "block" }).clientId,
    ).toBe("acme");
  });
});

describe("budgetWindow", () => {
  it("daily spans the current UTC day through now", () => {
    const now = new Date("2026-10-02T13:45:30.000Z");
    expect(budgetWindow("daily", now)).toEqual({
      since: "2026-10-02T00:00:00.000Z",
      until: "2026-10-02T13:45:30.000Z",
    });
  });

  it("rolling_30d spans exactly 30 days through now", () => {
    const now = new Date("2026-10-02T00:00:00.000Z");
    expect(budgetWindow("rolling_30d", now)).toEqual({
      since: "2026-09-02T00:00:00.000Z",
      until: "2026-10-02T00:00:00.000Z",
    });
  });
});
