import { Decimal } from "../cost/decimal.js";

export type BudgetStatusLevel = "below_limit" | "at_limit" | "over_limit";

export interface BudgetStatus {
  /** limitUsd − currentSpendUsd; may be negative (never clamped). */
  remainingUsd: string;
  /** currentSpendUsd / limitUsd as a 6-decimal ratio string (not a percentage). */
  utilization: string;
  status: BudgetStatusLevel;
}

/**
 * Derive utilization/status from persisted spend only — the current request's
 * estimated cost is NOT included (that is enforcement, not status). Exact
 * Decimal arithmetic; limitUsd is guaranteed > 0 by the budget schema.
 */
export function budgetStatus(input: { limitUsd: string; currentSpendUsd: string }): BudgetStatus {
  const limit = new Decimal(input.limitUsd);
  const spend = new Decimal(input.currentSpendUsd);
  const remaining = limit.minus(spend);
  const utilization = spend.div(limit).toFixed(6);
  const status: BudgetStatusLevel = spend.lt(limit)
    ? "below_limit"
    : spend.eq(limit)
      ? "at_limit"
      : "over_limit";
  return { remainingUsd: remaining.toFixed(6), utilization, status };
}
