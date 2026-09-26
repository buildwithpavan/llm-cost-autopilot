import { describe, expect, it } from "vitest";
import { parseReconciliationMetrics } from "../src/lib/api/metrics";

const SAMPLE = `# HELP lca_reconciliation_rate Rolling reconciled-request rate.
# TYPE lca_reconciliation_rate gauge
lca_reconciliation_rate 0.973
# HELP lca_reconciliation_alert_active alert
# TYPE lca_reconciliation_alert_active gauge
lca_reconciliation_alert_active 0
# HELP lca_requests_total Total requests.
# TYPE lca_requests_total counter
`;

describe("parseReconciliationMetrics", () => {
  it("parses the two reconciliation gauges", () => {
    const m = parseReconciliationMetrics(SAMPLE);
    expect(m.rate).toBeCloseTo(0.973, 5);
    expect(m.alertActive).toBe(false);
  });

  it("reads an active alert as true", () => {
    const m = parseReconciliationMetrics("lca_reconciliation_rate 0.9\nlca_reconciliation_alert_active 1\n");
    expect(m.alertActive).toBe(true);
  });

  it("returns null (unavailable, not zero) when a series is absent", () => {
    const m = parseReconciliationMetrics("# only comments\nlca_requests_total 0\n");
    expect(m.rate).toBeNull();
    expect(m.alertActive).toBeNull();
  });

  it("returns null rate for a malformed value", () => {
    const m = parseReconciliationMetrics("lca_reconciliation_rate not_a_number\n");
    expect(m.rate).toBeNull();
  });

  it("does not confuse the rate gauge with a similarly-prefixed series", () => {
    const m = parseReconciliationMetrics("lca_reconciliation_rate_bucket 5\nlca_reconciliation_rate 0.5\n");
    expect(m.rate).toBe(0.5);
  });
});
