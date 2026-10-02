import type { BudgetPeriod } from "../types/budget.js";

export interface BudgetWindow {
  /** Inclusive lower bound (ISO-8601 UTC). */
  since: string;
  /** Inclusive upper bound (ISO-8601 UTC). */
  until: string;
}

/**
 * Translate a budget period into a telemetry spend window. Windows never exceed
 * the 30-day raw-event retention boundary.
 *   daily       → current UTC calendar day (00:00:00Z → now)
 *   rolling_30d → now − 30 days → now
 */
export function budgetWindow(period: BudgetPeriod, now: Date = new Date()): BudgetWindow {
  const until = now.toISOString();
  if (period === "daily") {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
    );
    return { since: start.toISOString(), until };
  }
  const start = new Date(now.getTime() - 30 * 86_400_000);
  return { since: start.toISOString(), until };
}
