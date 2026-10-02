import { budgets as coreBudgets, type Budget } from "@lca/core";

import { spendForBudgets } from "./spend.js";
import type { Db } from "../db/schema.js";

export interface BudgetMetricsSnapshot {
  /** Max utilization (spend/limit) across enabled budgets; 0 when none. Numeric for Prometheus. */
  maxUtilization: number;
  /** True when any enabled budget is at or over its limit (exact Decimal spend >= limit). */
  alertActive: boolean;
  /** Count of enabled budgets evaluated. */
  evaluated: number;
}

/**
 * Operator-level budget aggregate for Prometheus. Considers ALL enabled
 * configured budgets (not a single request's client). Spend basis is persisted
 * estimatedCostUsd via each budget's window — never hypothetical request cost.
 * Over-limit is decided by exact Decimal comparison (budgetStatus); only the
 * utilization value is converted to a number at the final metric boundary.
 */
export async function computeBudgetMetrics(
  db: Db,
  budgets: readonly Budget[],
  now: Date = new Date(),
): Promise<BudgetMetricsSnapshot> {
  const enabled = budgets.filter((b) => b.enabled);
  if (enabled.length === 0) return { maxUtilization: 0, alertActive: false, evaluated: 0 };

  const spendByBudget = await spendForBudgets(db, enabled, now);
  let maxUtilization = 0;
  let alertActive = false;
  for (const b of enabled) {
    const s = coreBudgets.budgetStatus({
      limitUsd: b.limitUsd,
      currentSpendUsd: spendByBudget[b.budgetId] ?? "0",
    });
    const util = Number(s.utilization); // final numeric boundary only
    if (util > maxUtilization) maxUtilization = util;
    if (s.status === "at_limit" || s.status === "over_limit") alertActive = true;
  }
  return { maxUtilization, alertActive, evaluated: enabled.length };
}
