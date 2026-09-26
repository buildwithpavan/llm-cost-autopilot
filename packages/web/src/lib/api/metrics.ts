import { apiRequestText } from "./client.js";

/**
 * The only request-relevant series `/metrics` actually emits today are the two
 * reconciliation gauges. `null` means the series was absent from the scrape
 * (unavailable) — deliberately distinct from a real `0`.
 */
export interface ReconciliationMetrics {
  rate: number | null;
  alertActive: boolean | null;
}

/** Parse a single unlabeled Prometheus gauge sample. Returns null when absent. */
function parseGauge(text: string, name: string): number | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}(?:\\{[^}]*\\})?\\s+([-+0-9.eE]+)\\s*$`, "m");
  const m = re.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function parseReconciliationMetrics(text: string): ReconciliationMetrics {
  const alert = parseGauge(text, "lca_reconciliation_alert_active");
  return {
    rate: parseGauge(text, "lca_reconciliation_rate"),
    alertActive: alert === null ? null : alert >= 0.5,
  };
}

export async function getReconciliationMetrics(signal?: AbortSignal): Promise<ReconciliationMetrics> {
  const text = await apiRequestText("/metrics", signal ? { signal } : {});
  return parseReconciliationMetrics(text);
}
