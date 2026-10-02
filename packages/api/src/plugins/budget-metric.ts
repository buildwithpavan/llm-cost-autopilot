import { computeBudgetMetrics, type BudgetStore, type Db } from "@lca/persistence";

import { getSharedMetrics } from "./metrics.js";

export interface BudgetMetricLoopOptions {
  intervalMs?: number;
  now?: () => Date;
}

/**
 * Maintains lca_budget_utilization and lca_budget_alert_active from the current
 * persisted spend of ALL enabled configured budgets (operator-level aggregate;
 * no per-client/budget labels). Periodic to keep Prometheus scrapes cheap.
 */
export function startBudgetMetricLoop(
  db: Db,
  budgetStore: BudgetStore,
  opts: BudgetMetricLoopOptions = {},
): () => void {
  const intervalMs = opts.intervalMs ?? 30_000;
  const now = opts.now ?? (() => new Date());
  const metrics = getSharedMetrics();

  async function tick(): Promise<void> {
    const all = await budgetStore.list();
    const snap = await computeBudgetMetrics(db, all, now());
    metrics.budgetUtilization.set(snap.maxUtilization);
    metrics.budgetAlertActive.set(snap.alertActive ? 1 : 0);
  }

  const handle = setInterval(() => {
    void tick().catch(() => {
      /* logged elsewhere */
    });
  }, intervalMs);
  handle.unref?.();
  void tick().catch(() => {});

  return () => clearInterval(handle);
}
