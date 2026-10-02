import { describe, expect, it } from "vitest";

import { evaluateBudgets } from "../src/budgets/aggregate.js";
import type { Budget } from "../src/types/budget.js";

function budget(over: Partial<Budget> & Pick<Budget, "budgetId">): Budget {
  return {
    scope: "global",
    clientId: null,
    period: "daily",
    limitUsd: "10.000000",
    action: "block",
    enabled: true,
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    ...over,
  };
}

describe("evaluateBudgets", () => {
  it("returns no_budget when no budgets apply", () => {
    const r = evaluateBudgets({ budgets: [], spendByBudget: {}, requestEstimatedCostUsd: "1.000000" });
    expect(r.decision).toBe("no_budget");
    expect(r.evaluations).toEqual([]);
    expect(r.blockedBudgetIds).toEqual([]);
  });

  it("allows a single global budget under limit", () => {
    const r = evaluateBudgets({
      budgets: [budget({ budgetId: "g1", limitUsd: "10" })],
      spendByBudget: { g1: "1.000000" },
      requestEstimatedCostUsd: "1.000000",
    });
    expect(r.decision).toBe("allowed");
    expect(r.evaluations).toHaveLength(1);
  });

  it("warns for a warn budget at/over limit", () => {
    const r = evaluateBudgets({
      budgets: [budget({ budgetId: "g1", action: "warn", limitUsd: "2" })],
      spendByBudget: { g1: "1.500000" },
      requestEstimatedCostUsd: "1.000000",
    });
    expect(r.decision).toBe("warned");
    expect(r.blockedBudgetIds).toEqual([]);
  });

  it("blocks for a block budget at/over limit", () => {
    const r = evaluateBudgets({
      budgets: [budget({ budgetId: "g1", action: "block", limitUsd: "2" })],
      spendByBudget: { g1: "1.500000" },
      requestEstimatedCostUsd: "1.000000",
    });
    expect(r.decision).toBe("blocked");
    expect(r.blockedBudgetIds).toEqual(["g1"]);
  });

  it("combines a global and a client budget", () => {
    const r = evaluateBudgets({
      budgets: [
        budget({ budgetId: "g1", scope: "global", action: "warn", limitUsd: "100" }),
        budget({ budgetId: "c1", scope: "client", clientId: "acme", action: "warn", limitUsd: "2" }),
      ],
      spendByBudget: { g1: "1.000000", c1: "1.900000" },
      requestEstimatedCostUsd: "0.500000",
    });
    expect(r.decision).toBe("warned");
    expect(r.evaluations).toHaveLength(2);
  });

  it("block wins over warn when both apply", () => {
    const r = evaluateBudgets({
      budgets: [
        budget({ budgetId: "warnB", action: "warn", limitUsd: "1" }),
        budget({ budgetId: "blockB", action: "block", limitUsd: "1" }),
      ],
      spendByBudget: { warnB: "1.000000", blockB: "1.000000" },
      requestEstimatedCostUsd: "0.500000",
    });
    expect(r.decision).toBe("blocked");
    expect(r.blockedBudgetIds).toEqual(["blockB"]);
    // block ordered before warn.
    expect(r.evaluations[0]!.decision).toBe("block");
  });

  it("orders multiple warnings deterministically (least remaining first, then id)", () => {
    const r = evaluateBudgets({
      budgets: [
        budget({ budgetId: "wB", action: "warn", limitUsd: "10" }),
        budget({ budgetId: "wA", action: "warn", limitUsd: "10" }),
      ],
      // Same remaining → tiebreak by budgetId asc.
      spendByBudget: { wA: "10.000000", wB: "10.000000" },
      requestEstimatedCostUsd: "0.000000",
    });
    expect(r.evaluations.map((e) => e.budgetId)).toEqual(["wA", "wB"]);
  });

  it("orders multiple blocks deterministically by remaining then id", () => {
    const r = evaluateBudgets({
      budgets: [
        budget({ budgetId: "b1", action: "block", limitUsd: "10" }),
        budget({ budgetId: "b2", action: "block", limitUsd: "10" }),
      ],
      spendByBudget: { b1: "9.000000", b2: "20.000000" }, // b2 more over-budget → less remaining first
      requestEstimatedCostUsd: "2.000000",
    });
    expect(r.evaluations.map((e) => e.budgetId)).toEqual(["b2", "b1"]);
    expect(r.blockedBudgetIds).toEqual(["b2", "b1"]);
  });

  it("uses exact decimal request cost (no float drift)", () => {
    const r = evaluateBudgets({
      budgets: [budget({ budgetId: "g1", action: "block", limitUsd: "0.300000" })],
      spendByBudget: { g1: "0.100000" },
      requestEstimatedCostUsd: "0.200000",
    });
    expect(r.evaluations[0]!.projectedSpendUsd).toBe("0.300000");
    expect(r.decision).toBe("blocked");
  });

  it("treats the exact limit boundary as over budget", () => {
    const r = evaluateBudgets({
      budgets: [budget({ budgetId: "g1", action: "block", limitUsd: "5" })],
      spendByBudget: { g1: "4.000000" },
      requestEstimatedCostUsd: "1.000000",
    });
    expect(r.evaluations[0]!.remainingUsd).toBe("0.000000");
    expect(r.decision).toBe("blocked");
  });

  it("reports zero and negative remaining", () => {
    const r = evaluateBudgets({
      budgets: [
        budget({ budgetId: "zero", action: "warn", limitUsd: "1" }),
        budget({ budgetId: "neg", action: "warn", limitUsd: "1" }),
      ],
      spendByBudget: { zero: "1.000000", neg: "5.000000" },
      requestEstimatedCostUsd: "0.000000",
    });
    const byId = Object.fromEntries(r.evaluations.map((e) => [e.budgetId, e.remainingUsd]));
    expect(byId["zero"]).toBe("0.000000");
    expect(byId["neg"]).toBe("-4.000000");
  });

  it("defaults missing spend to zero", () => {
    const r = evaluateBudgets({
      budgets: [budget({ budgetId: "g1", action: "block", limitUsd: "10" })],
      spendByBudget: {},
      requestEstimatedCostUsd: "1.000000",
    });
    expect(r.evaluations[0]!.currentSpendUsd).toBe("0.000000");
    expect(r.decision).toBe("allowed");
  });

  it("retains all applicable budget results", () => {
    const r = evaluateBudgets({
      budgets: [
        budget({ budgetId: "a", action: "warn", limitUsd: "100" }),
        budget({ budgetId: "b", action: "block", limitUsd: "1" }),
        budget({ budgetId: "c", action: "warn", limitUsd: "100" }),
      ],
      spendByBudget: { a: "1", b: "1", c: "1" },
      requestEstimatedCostUsd: "0.100000",
    });
    expect(r.evaluations).toHaveLength(3);
    expect(new Set(r.evaluations.map((e) => e.budgetId))).toEqual(new Set(["a", "b", "c"]));
  });
});
