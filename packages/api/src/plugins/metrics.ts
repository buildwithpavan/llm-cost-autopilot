import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export interface Metrics {
  registry: Registry;
  requestsTotal: Counter<string>;
  requestDurationSeconds: Histogram<string>;
  routingOverheadMs: Histogram<string>;
  reconciliationRate: Gauge<string>;
  reconciliationAlertActive: Gauge<string>;
  budgetUtilization: Gauge<string>;
  budgetAlertActive: Gauge<string>;
}

export function createMetrics(): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const requestsTotal = new Counter({
    name: "lca_requests_total",
    help: "Total number of completion requests handled.",
    labelNames: ["status", "provider_id", "model_id", "decision_source"],
    registers: [registry],
  });

  const requestDurationSeconds = new Histogram({
    name: "lca_request_duration_seconds",
    help: "End-to-end request duration.",
    labelNames: ["provider_id", "model_id"],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [registry],
  });

  const routingOverheadMs = new Histogram({
    name: "lca_routing_overhead_ms",
    help: "Milliseconds spent in the routing pipeline (excluding provider call).",
    buckets: [1, 2, 5, 10, 20, 50, 75, 100, 150, 250, 500],
    registers: [registry],
  });

  const reconciliationRate = new Gauge({
    name: "lca_reconciliation_rate",
    help: "Rolling reconciled-request rate over the FR-019a window.",
    registers: [registry],
  });

  const reconciliationAlertActive = new Gauge({
    name: "lca_reconciliation_alert_active",
    help: "1 when the reconciliation rate is below 95% over the FR-019a window; 0 otherwise.",
    registers: [registry],
  });

  // Operator-level budget aggregates. No per-client/per-budget labels (bounded
  // cardinality). Basis is persisted estimated spend — NOT hypothetical current
  // request cost. Semantics mirror GET /v1/budgets/status.
  const budgetUtilization = new Gauge({
    name: "lca_budget_utilization",
    help: "Maximum current utilization (persisted estimated spend / limit) across all enabled configured budgets; 0 when none.",
    registers: [registry],
  });

  const budgetAlertActive = new Gauge({
    name: "lca_budget_alert_active",
    help: "1 when any enabled configured budget is at or over its limit (exact spend >= limit); 0 otherwise.",
    registers: [registry],
  });

  return {
    registry,
    requestsTotal,
    requestDurationSeconds,
    routingOverheadMs,
    reconciliationRate,
    reconciliationAlertActive,
    budgetUtilization,
    budgetAlertActive,
  };
}

let sharedMetrics: Metrics | undefined;

/** Return the process-wide metrics singleton, creating it on first call. */
export function getSharedMetrics(): Metrics {
  if (!sharedMetrics) sharedMetrics = createMetrics();
  return sharedMetrics;
}
