"use client";
import { useMemo } from "react";
import { AlertTriangle, AlertCircle, Info, Lightbulb, ArrowUpRight } from "lucide-react";

import type { Async } from "../overview/overview-model.js";
import type { InsightSeverity, OptimizationInsightsResponse } from "../../lib/api/telemetry.js";
import { presentInsights, insightAriaLabel, type InsightRow } from "./insights-model.js";
import styles from "./Cost.module.css";

export function CostOptimizationPanel({ section }: { section: Async<OptimizationInsightsResponse> }) {
  const data = section.status === "ready" ? section.data : null;
  const rows = useMemo(() => (data ? presentInsights(data.insights) : []), [data]);

  return (
    <section className={styles.panel} aria-labelledby="cost-insights-heading">
      <div className={styles.panelHead}>
        <span id="cost-insights-heading">
          <Lightbulb size={13} color="var(--accent-primary)" aria-hidden /> Cost Optimization Insights
        </span>
        <span className={styles.windowMeta}>Advisory only · no automatic routing or budget changes</span>
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
        <div className={styles.empty}>No cost optimization insights for this window.</div>
      ) : (
        <div className={styles.insightList}>
          {rows.map((r) => (
            <InsightCard key={r.id} row={r} />
          ))}
        </div>
      )}
    </section>
  );
}

function InsightCard({ row }: { row: InsightRow }) {
  return (
    <article className={styles.insightCard} aria-label={insightAriaLabel(row)}>
      <div className={styles.insightTop}>
        <SeverityBadge severity={row.severity} label={row.severityLabel} />
        <span className={styles.insightType}>{row.typeLabel}</span>
        <span className={styles.insightSubject}>{row.subject}</span>
        <span className={styles.insightMag}>
          <span className={styles.insightMagValue}>{row.magnitudeDisplay}</span>
          <span className={styles.insightMagLabel}>{row.magnitudeLabel}</span>
        </span>
      </div>

      <div className={styles.insightTitle}>{row.title}</div>
      <div className={styles.insightDesc}>{row.description}</div>

      <dl className={styles.insightDetails}>
        {row.details.map((d) => (
          <div key={d.label} className={styles.insightDetail}>
            <dt className={styles.insightDetailLabel}>{d.label}</dt>
            <dd className={styles.insightDetailValue}>{d.value}</dd>
          </div>
        ))}
      </dl>

      {row.isPricingComparison ? (
        <div className={styles.insightNote}>
          {row.compatibilityLabel}
          {row.assumptions.length > 0 ? (
            <ul className={styles.insightAssumptions}>
              {row.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {row.simulateHref ? (
        <div className={styles.insightFoot}>
          <a className={styles.inlineLink} href={row.simulateHref}>
            Compare with simulation <ArrowUpRight size={12} aria-hidden />
          </a>
        </div>
      ) : null}
    </article>
  );
}

function SeverityBadge({ severity, label }: { severity: InsightSeverity; label: string }) {
  const Icon = severity === "critical" ? AlertTriangle : severity === "warning" ? AlertCircle : Info;
  const cls =
    severity === "critical" ? styles.sevCritical : severity === "warning" ? styles.sevWarning : styles.sevInfo;
  return (
    <span className={`${styles.sevBadge} ${cls}`}>
      <Icon size={12} aria-hidden /> {label}
    </span>
  );
}
