import { Decimal } from "../cost/decimal.js";
import type { BudgetAction } from "../types/budget.js";

export interface BudgetEvaluationInput {
  /** Spend already recorded in the budget window, as a decimal USD string. */
  currentSpendUsd: string;
  /** Estimated cost of the incoming request, as a decimal USD string. */
  requestEstimatedCostUsd: string;
  /** Budget limit, as a decimal USD string. */
  limitUsd: string;
  action: BudgetAction;
}

export type BudgetDecision = "allow" | "warn" | "block";

export interface BudgetEvaluation {
  decision: BudgetDecision;
  action: BudgetAction;
  currentSpendUsd: string;
  requestEstimatedCostUsd: string;
  projectedSpendUsd: string;
  limitUsd: string;
  /** limitUsd − projectedSpendUsd; may be exactly zero or negative (never clamped). */
  remainingUsd: string;
  /** projectedSpendUsd reaches or exceeds limitUsd. */
  overBudget: boolean;
}

/**
 * Pure, deterministic budget evaluation. Projected spend is current + request
 * estimate computed with exact Decimal arithmetic. Semantics:
 *   projected < limit            → allow
 *   projected >= limit, block    → block
 *   projected >= limit, warn     → warn (allowed, flagged)
 * Remaining is reported exactly and is never clamped.
 */
export function evaluateBudget(input: BudgetEvaluationInput): BudgetEvaluation {
  const current = new Decimal(input.currentSpendUsd);
  const estimate = new Decimal(input.requestEstimatedCostUsd);
  const limit = new Decimal(input.limitUsd);
  const projected = current.plus(estimate);
  const remaining = limit.minus(projected);
  const overBudget = projected.gte(limit);

  const decision: BudgetDecision = !overBudget
    ? "allow"
    : input.action === "block"
      ? "block"
      : "warn";

  return {
    decision,
    action: input.action,
    currentSpendUsd: current.toFixed(6),
    requestEstimatedCostUsd: estimate.toFixed(6),
    projectedSpendUsd: projected.toFixed(6),
    limitUsd: limit.toFixed(6),
    remainingUsd: remaining.toFixed(6),
    overBudget,
  };
}
