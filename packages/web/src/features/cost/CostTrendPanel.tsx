"use client";
import { useMemo, useState } from "react";
import { TrendingUp, AlertTriangle } from "lucide-react";

import type { Async } from "../overview/overview-model.js";
import type { TimeseriesResponse } from "../../lib/api/telemetry.js";
import {
  TREND_METRICS,
  type TrendMetric,
  type TrendPoint,
  toTrendPoints,
  metricMax,
  hasAnyActivity,
  formatMetricMax,
  formatBucketLabel,
  trendBucketDetail,
  bucketAriaLabel,
} from "./timeseries-model.js";
import type { TimeseriesBucket } from "../../lib/api/telemetry.js";
import styles from "./Cost.module.css";

const X_TICKS = 6;

/** Evenly-spaced x-axis tick indices (deduplicated). */
function tickIndices(n: number): Set<number> {
  if (n <= 1) return new Set([0]);
  const count = Math.min(X_TICKS, n);
  const out = new Set<number>();
  for (let i = 0; i < count; i++) out.add(Math.round((i * (n - 1)) / (count - 1)));
  return out;
}

export function CostTrendPanel({ section }: { section: Async<TimeseriesResponse> }) {
  const [metric, setMetric] = useState<TrendMetric>("cost");
  const [active, setActive] = useState<number | null>(null);

  const data = section.status === "ready" ? section.data : null;
  const points = useMemo(() => (data ? toTrendPoints(data) : []), [data]);
  const bucket: TimeseriesBucket = data?.bucket ?? "hour";
  const max = useMemo(() => metricMax(points, metric), [points, metric]);
  const activity = useMemo(() => hasAnyActivity(points), [points]);

  return (
    <section className={styles.panel} aria-labelledby="cost-trend-heading">
      <div className={styles.panelHead}>
        <span id="cost-trend-heading">
          <TrendingUp size={13} color="var(--accent-primary)" aria-hidden /> Cost &amp; Usage Trend
        </span>
        <div className={styles.segGroup} role="group" aria-label="Trend metric">
          {TREND_METRICS.map((m) => (
            <button
              key={m.value}
              type="button"
              className={m.value === metric ? styles.segBtnActive : styles.segBtn}
              aria-pressed={m.value === metric}
              onClick={() => setMetric(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {section.status === "loading" ? (
        <div className={styles.chartSkel} aria-hidden />
      ) : section.status === "error" ? (
        <div className={styles.sectionError} role="alert">
          <AlertTriangle size={14} aria-hidden /> {section.message}
        </div>
      ) : !activity ? (
        <div className={styles.empty}>No activity in the selected window.</div>
      ) : (
        <TrendChart
          points={points}
          metric={metric}
          max={max}
          bucket={bucket}
          active={active}
          setActive={setActive}
        />
      )}
    </section>
  );
}

interface ChartProps {
  points: TrendPoint[];
  metric: TrendMetric;
  max: number;
  bucket: TimeseriesBucket;
  active: number | null;
  setActive: (i: number | null) => void;
}

function TrendChart({ points, metric, max, bucket, active, setActive }: ChartProps) {
  const ticks = useMemo(() => tickIndices(points.length), [points.length]);
  const activePoint = active !== null ? points[active] : undefined;
  const detail = activePoint ? trendBucketDetail(activePoint, bucket, metric) : null;

  // Final presentation-boundary conversion only: exact integer units → a 0..1
  // ratio for geometry. Never used for totals, comparisons, or money logic.
  const frac = (value: number): number => (max > 0 ? value / max : 0);

  return (
    <div className={styles.chartWrap}>
      <div className={styles.detailStrip} role="status" aria-live="polite">
        {detail ? (
          <>
            <span className={styles.detailTime}>{detail.time}</span>
            <span className={styles.detailItem}>Est. {detail.estimatedCost}</span>
            <span className={styles.detailItem}>
              Actual {detail.actualCost ?? "pending"}
              {detail.pendingNote ? ` · ${detail.pendingNote}` : ""}
            </span>
            <span className={styles.detailItem}>{detail.requests} req</span>
            <span className={styles.detailItem}>
              {detail.inputTokens} in · {detail.outputTokens} out
            </span>
          </>
        ) : (
          <span className={styles.detailHint}>Hover or focus a bar for bucket details.</span>
        )}
      </div>

      <div className={styles.chartBody}>
        <div className={styles.yAxis} aria-hidden>
          <span>{formatMetricMax(max, metric)}</span>
          <span>{formatMetricMax(Math.round(max / 2), metric)}</span>
          <span>0</span>
        </div>
        <div
          className={styles.bars}
          role="group"
          aria-label={`Cost and usage trend, ${points.length} ${bucket} buckets, metric ${metric}`}
        >
          {points.map((p, i) => (
            <button
              key={p.bucketStart}
              type="button"
              className={active === i ? styles.colActive : styles.col}
              aria-label={bucketAriaLabel(p, bucket)}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <span className={styles.colTrack}>
                {metric === "tokens" ? (
                  <>
                    <span
                      className={styles.fillTokOut}
                      style={{ height: `${frac(p.totalTokens) * 100}%`, bottom: `${frac(p.inputTokens) * 100}%` }}
                      aria-hidden
                    />
                    <span
                      className={styles.fillTokIn}
                      style={{ height: `${frac(p.inputTokens) * 100}%` }}
                      aria-hidden
                    />
                  </>
                ) : metric === "requests" ? (
                  <span className={styles.fillRequests} style={{ height: `${frac(p.requestCount) * 100}%` }} aria-hidden />
                ) : (
                  <>
                    <span className={styles.fillEstimated} style={{ height: `${frac(p.estimatedMicroUsd) * 100}%` }} aria-hidden />
                    {p.hasActual ? (
                      <span className={styles.actualMarker} style={{ bottom: `${frac(p.actualMicroUsd) * 100}%` }} aria-hidden />
                    ) : null}
                    {p.pendingActualCostCount > 0 ? <span className={styles.pendingTick} aria-hidden /> : null}
                  </>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.xAxis} aria-hidden>
        {points.map((p, i) => (
          <span key={p.bucketStart} className={styles.xTick}>
            {ticks.has(i) ? formatBucketLabel(p.bucketStart, bucket) : ""}
          </span>
        ))}
      </div>

      <TrendLegend metric={metric} />
    </div>
  );
}

function TrendLegend({ metric }: { metric: TrendMetric }) {
  return (
    <div className={styles.legend}>
      {metric === "cost" ? (
        <>
          <Swatch className={styles.swEstimated} label="Estimated cost" />
          <Swatch className={styles.swActual} label="Actual (reconciled)" />
          <Swatch className={styles.swPending} label="Pending reconciliation" />
        </>
      ) : metric === "requests" ? (
        <Swatch className={styles.swRequests} label="Requests" />
      ) : (
        <>
          <Swatch className={styles.swTokIn} label="Input tokens" />
          <Swatch className={styles.swTokOut} label="Output tokens" />
        </>
      )}
    </div>
  );
}

function Swatch({ className, label }: { className: string | undefined; label: string }) {
  return (
    <span className={styles.legendItem}>
      <span className={[styles.swatch, className].filter(Boolean).join(" ")} aria-hidden />
      {label}
    </span>
  );
}
