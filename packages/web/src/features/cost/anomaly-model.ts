import { formatUsd } from "../../lib/format.js";
import type { AnomalyRecord, AnomalySeverity } from "../../lib/api/telemetry.js";
import type { TimeseriesBucket } from "../../lib/api/telemetry.js";
import { formatBucketFull } from "./timeseries-model.js";

export const SEVERITY_LABEL: Record<AnomalySeverity, string> = {
  warning: "Warning",
  critical: "Critical",
};

/** Presentation row for a cost anomaly. Raw decimal strings are preserved; the
 * `*Display` fields format them at the presentation boundary only (no money math). */
export interface AnomalyRow {
  bucketStart: string;
  time: string;
  severity: AnomalySeverity;
  severityLabel: string;
  estimatedCostUsd: string;
  baselineEstimatedCostUsd: string;
  deviationUsd: string;
  deviationPercent: string;
  historicalBucketCount: number;
  estimatedDisplay: string;
  baselineDisplay: string;
  deviationDisplay: string;
  deviationPercentDisplay: string;
}

export function presentAnomaly(a: AnomalyRecord, bucket: TimeseriesBucket): AnomalyRow {
  return {
    bucketStart: a.bucketStart,
    time: formatBucketFull(a.bucketStart, bucket),
    severity: a.severity,
    severityLabel: SEVERITY_LABEL[a.severity],
    estimatedCostUsd: a.estimatedCostUsd,
    baselineEstimatedCostUsd: a.baselineEstimatedCostUsd,
    deviationUsd: a.deviationUsd,
    deviationPercent: a.deviationPercent,
    historicalBucketCount: a.historicalBucketCount,
    estimatedDisplay: formatUsd(a.estimatedCostUsd),
    baselineDisplay: formatUsd(a.baselineEstimatedCostUsd),
    deviationDisplay: formatUsd(a.deviationUsd),
    deviationPercentDisplay: `+${a.deviationPercent}%`,
  };
}

export function presentAnomalies(records: readonly AnomalyRecord[], bucket: TimeseriesBucket): AnomalyRow[] {
  return records.map((a) => presentAnomaly(a, bucket));
}

/** Accessible, color-independent summary for a single anomaly row. */
export function anomalyAriaLabel(row: AnomalyRow): string {
  return [
    `${row.severityLabel} cost anomaly`,
    row.time,
    `estimated ${row.estimatedDisplay}`,
    `baseline ${row.baselineDisplay}`,
    `deviation ${row.deviationDisplay} (${row.deviationPercentDisplay})`,
    `over ${row.historicalBucketCount} historical buckets`,
  ].join(", ");
}
