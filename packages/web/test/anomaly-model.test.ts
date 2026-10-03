import { describe, expect, it } from "vitest";

import type { AnomalyRecord } from "../src/lib/api/telemetry";
import {
  presentAnomaly,
  presentAnomalies,
  anomalyAriaLabel,
  SEVERITY_LABEL,
} from "../src/features/cost/anomaly-model";

const warning: AnomalyRecord = {
  bucketStart: "2026-10-01T08:00:00Z",
  estimatedCostUsd: "0.160000",
  baselineEstimatedCostUsd: "0.100000",
  deviationUsd: "0.060000",
  deviationPercent: "60.00",
  historicalBucketCount: 8,
  severity: "warning",
};

const critical: AnomalyRecord = {
  bucketStart: "2026-10-02T00:00:00Z",
  estimatedCostUsd: "0.300000",
  baselineEstimatedCostUsd: "0.100000",
  deviationUsd: "0.200000",
  deviationPercent: "200.00",
  historicalBucketCount: 8,
  severity: "critical",
};

describe("presentAnomaly", () => {
  it("preserves exact decimal strings and formats display at the boundary only", () => {
    const r = presentAnomaly(warning, "hour");
    // Raw values unchanged (no money math).
    expect(r.estimatedCostUsd).toBe("0.160000");
    expect(r.baselineEstimatedCostUsd).toBe("0.100000");
    expect(r.deviationUsd).toBe("0.060000");
    expect(r.deviationPercent).toBe("60.00");
    // Display formatting.
    expect(r.estimatedDisplay).toContain("$");
    expect(r.deviationPercentDisplay).toBe("+60.00%");
    expect(r.historicalBucketCount).toBe(8);
  });

  it("formats the hour bucket timestamp in UTC", () => {
    expect(presentAnomaly(warning, "hour").time).toBe("Oct 1, 08:00 UTC");
    expect(presentAnomaly(critical, "day").time).toBe("Oct 2, 2026");
  });

  it("labels severity deterministically", () => {
    expect(presentAnomaly(warning, "hour").severityLabel).toBe("Warning");
    expect(presentAnomaly(critical, "day").severityLabel).toBe("Critical");
    expect(SEVERITY_LABEL.warning).toBe("Warning");
    expect(SEVERITY_LABEL.critical).toBe("Critical");
  });
});

describe("presentAnomalies", () => {
  it("maps a list preserving order", () => {
    const rows = presentAnomalies([warning, critical], "hour");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.bucketStart).toBe("2026-10-01T08:00:00Z");
    expect(rows[1]!.bucketStart).toBe("2026-10-02T00:00:00Z");
  });

  it("returns an empty array for no anomalies", () => {
    expect(presentAnomalies([], "day")).toEqual([]);
  });
});

describe("anomalyAriaLabel", () => {
  it("conveys severity and values without relying on color", () => {
    const a = anomalyAriaLabel(presentAnomaly(critical, "day"));
    expect(a).toContain("Critical cost anomaly");
    expect(a).toContain("Oct 2, 2026");
    expect(a).toContain("estimated");
    expect(a).toContain("baseline");
    expect(a).toContain("deviation");
    expect(a).toContain("8 historical buckets");
  });
});
