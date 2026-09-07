import { readReconciliationWindow, type Db } from "@lca/persistence";

import { getSharedMetrics } from "./metrics.js";

export interface ReconciliationLoopOptions {
  windowMinutes?: number;
  windowRows?: number;
  intervalMs?: number;
  alertThreshold?: number;
}

/**
 * Starts a background loop that maintains lca_reconciliation_rate and
 * lca_reconciliation_alert_active per FR-019a:
 *   - window: trailing 60 minutes OR 1,000 most-recent reconcilable requests
 *   - alert active when rate < 0.95
 *   - alert clears once rate ≥ 0.95 for one complete window
 */
export function startReconciliationMetricLoop(
  db: Db,
  opts: ReconciliationLoopOptions = {},
): () => void {
  const windowMinutes = opts.windowMinutes ?? 60;
  const windowRows = opts.windowRows ?? 1_000;
  const intervalMs = opts.intervalMs ?? 30_000;
  const threshold = opts.alertThreshold ?? 0.95;

  const metrics = getSharedMetrics();
  let alertActive = false;
  let clearRunStart: number | null = null;

  async function tick(): Promise<void> {
    const stats = await readReconciliationWindow(db, { windowMinutes, windowRows });
    metrics.reconciliationRate.set(stats.rate);
    if (stats.sampleCount === 0) {
      metrics.reconciliationAlertActive.set(alertActive ? 1 : 0);
      return;
    }
    if (stats.rate < threshold) {
      alertActive = true;
      clearRunStart = null;
    } else {
      if (alertActive) {
        // Require a full window (windowMinutes) at ≥ threshold before clearing.
        if (clearRunStart === null) clearRunStart = Date.now();
        const elapsed = Date.now() - clearRunStart;
        if (elapsed >= windowMinutes * 60_000) {
          alertActive = false;
          clearRunStart = null;
        }
      } else {
        clearRunStart = null;
      }
    }
    metrics.reconciliationAlertActive.set(alertActive ? 1 : 0);
  }

  const handle = setInterval(() => {
    void tick().catch(() => {
      /* logged elsewhere */
    });
  }, intervalMs);
  handle.unref?.();
  // fire once immediately
  void tick().catch(() => {});

  return () => clearInterval(handle);
}