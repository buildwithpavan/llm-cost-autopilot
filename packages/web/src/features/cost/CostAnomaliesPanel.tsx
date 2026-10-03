"use client";
import { useMemo } from "react";
import { AlertTriangle, AlertCircle, Activity } from "lucide-react";

import type { Async } from "../overview/overview-model.js";
import type { AnomaliesResponse, AnomalySeverity } from "../../lib/api/telemetry.js";
import { presentAnomalies, anomalyAriaLabel } from "./anomaly-model.js";
import styles from "./Cost.module.css";

export function CostAnomaliesPanel({ section }: { section: Async<AnomaliesResponse> }) {
  const data = section.status === "ready" ? section.data : null;
  const rows = useMemo(
    () => (data ? presentAnomalies(data.anomalies, data.bucket) : []),
    [data],
  );

  return (
    <section className={styles.panel} aria-labelledby="cost-anomalies-heading">
      <div className={styles.panelHead}>
        <span id="cost-anomalies-heading">
          <Activity size={13} color="var(--warn)" aria-hidden /> Cost Anomalies
        </span>
        <span className={styles.windowMeta}>Estimated cost vs. historical baseline (deterministic)</span>
      </div>

      {section.status === "loading" ? (
        <div className={styles.skelStack}>
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className={styles.skelBar} />
          ))}
        </div>
      ) : section.status === "error" ? (
        <div className={styles.sectionError} role="alert">
          <AlertTriangle size={14} aria-hidden /> {section.message}
        </div>
      ) : rows.length === 0 ? (
        <div className={styles.empty}>No cost anomalies detected in this window.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Severity</th>
                <th>Bucket</th>
                <th className={styles.num}>Estimated</th>
                <th className={styles.num}>Baseline</th>
                <th className={styles.num}>Deviation</th>
                <th className={styles.num}>History</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.bucketStart} aria-label={anomalyAriaLabel(r)}>
                  <td><SeverityBadge severity={r.severity} label={r.severityLabel} /></td>
                  <td>{r.time}</td>
                  <td className={styles.num}>{r.estimatedDisplay}</td>
                  <td className={styles.num}>{r.baselineDisplay}</td>
                  <td className={styles.num}>
                    {r.deviationDisplay}
                    <span className={styles.devPct}> {r.deviationPercentDisplay}</span>
                  </td>
                  <td className={styles.num}>{r.historicalBucketCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SeverityBadge({ severity, label }: { severity: AnomalySeverity; label: string }) {
  const Icon = severity === "critical" ? AlertTriangle : AlertCircle;
  const cls = severity === "critical" ? styles.sevCritical : styles.sevWarning;
  return (
    <span className={`${styles.sevBadge} ${cls}`}>
      <Icon size={12} aria-hidden /> {label}
    </span>
  );
}
