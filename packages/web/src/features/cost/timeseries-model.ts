import { formatUsd, formatInt, formatTokens } from "../../lib/format.js";
import type { TimeseriesBucket, TimeseriesResponse } from "../../lib/api/telemetry.js";
import { parseMicroUsd, formatMicroUsd } from "./cost-model.js";
import type { CostRange } from "./useCostData.js";

export type TrendMetric = "cost" | "requests" | "tokens";

export const TREND_METRICS: { value: TrendMetric; label: string }[] = [
  { value: "cost", label: "Cost" },
  { value: "requests", label: "Requests" },
  { value: "tokens", label: "Tokens" },
];

/**
 * A single chart bucket. Money is carried as exact integer micro-USD (parsed
 * from the backend decimal strings) plus the original strings; counts are safe
 * integers. Nothing here performs floating-point money arithmetic.
 */
export interface TrendPoint {
  bucketStart: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: string;
  actualCostUsd: string;
  estimatedMicroUsd: number;
  actualMicroUsd: number;
  pendingActualCostCount: number;
  reconciledCount: number;
  /** At least one request in the bucket has a reconciled (non-null) actual cost. */
  hasActual: boolean;
  hasActivity: boolean;
}

export function toTrendPoints(res: TimeseriesResponse): TrendPoint[] {
  return res.buckets.map((b) => {
    const reconciledActualCount = b.requestCount - b.pendingActualCostCount;
    return {
      bucketStart: b.bucketStart,
      requestCount: b.requestCount,
      inputTokens: b.inputTokens,
      outputTokens: b.outputTokens,
      totalTokens: b.inputTokens + b.outputTokens,
      estimatedCostUsd: b.estimatedCostUsd,
      actualCostUsd: b.actualCostUsd,
      estimatedMicroUsd: parseMicroUsd(b.estimatedCostUsd),
      actualMicroUsd: parseMicroUsd(b.actualCostUsd),
      pendingActualCostCount: b.pendingActualCostCount,
      reconciledCount: b.reconciledCount,
      // Only claim an actual value exists when at least one request reconciled.
      hasActual: reconciledActualCount > 0,
      hasActivity: b.requestCount > 0,
    };
  });
}

/**
 * Deterministic bucket for a dashboard range: ≤ 48h → hourly, otherwise daily.
 * Every preset (24h/7d/30d) stays within the backend's 30-day maximum window.
 */
export function bucketForRange(range: CostRange): TimeseriesBucket {
  return range === "24h" ? "hour" : "day";
}

/** Per-point value for the selected metric's Y scaling (exact integer units). */
export function metricValue(p: TrendPoint, metric: TrendMetric): number {
  if (metric === "requests") return p.requestCount;
  if (metric === "tokens") return p.totalTokens;
  // Cost scale must fit both estimated and the (possibly larger) actual.
  return Math.max(p.estimatedMicroUsd, p.actualMicroUsd);
}

/** Maximum value across points for the selected metric (0 when no activity). */
export function metricMax(points: readonly TrendPoint[], metric: TrendMetric): number {
  let max = 0;
  for (const p of points) {
    const v = metricValue(p, metric);
    if (v > max) max = v;
  }
  return max;
}

export function hasAnyActivity(points: readonly TrendPoint[]): boolean {
  return points.some((p) => p.hasActivity);
}

/** Format the Y-axis maximum for the selected metric. */
export function formatMetricMax(max: number, metric: TrendMetric): string {
  if (metric === "cost") return formatUsd(formatMicroUsd(max));
  if (metric === "tokens") return formatTokens(max);
  return formatInt(max);
}

/* ---- Axis / tooltip formatting (UTC, matching the UTC-aligned buckets) ---- */

const dayShort = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const hourShort = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false });
const dayFull = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const hourFull = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatBucketLabel(iso: string, bucket: TimeseriesBucket): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return bucket === "hour" ? hourShort.format(d) : dayShort.format(d);
}

export function formatBucketFull(iso: string, bucket: TimeseriesBucket): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return bucket === "hour" ? `${hourFull.format(d)} UTC` : dayFull.format(d);
}

export interface TrendBucketDetail {
  time: string;
  /** Formatted value of the currently-selected metric. */
  metricValue: string;
  estimatedCost: string;
  /** Formatted actual cost, or null when no actual has reconciled yet. */
  actualCost: string | null;
  pendingNote: string | null;
  requests: string;
  inputTokens: string;
  outputTokens: string;
}

export function trendBucketDetail(
  p: TrendPoint,
  bucket: TimeseriesBucket,
  metric: TrendMetric,
): TrendBucketDetail {
  const metricValueStr =
    metric === "cost"
      ? formatUsd(formatMicroUsd(p.estimatedMicroUsd))
      : metric === "requests"
        ? formatInt(p.requestCount)
        : formatTokens(p.totalTokens);
  return {
    time: formatBucketFull(p.bucketStart, bucket),
    metricValue: metricValueStr,
    estimatedCost: formatUsd(formatMicroUsd(p.estimatedMicroUsd)),
    actualCost: p.hasActual ? formatUsd(formatMicroUsd(p.actualMicroUsd)) : null,
    pendingNote: p.pendingActualCostCount > 0 ? `${p.pendingActualCostCount} pending reconciliation` : null,
    requests: formatInt(p.requestCount),
    inputTokens: formatInt(p.inputTokens),
    outputTokens: formatInt(p.outputTokens),
  };
}

/** Accessible, comma-joined per-bucket summary (so SVG/CSS bars need no data table). */
export function bucketAriaLabel(p: TrendPoint, bucket: TimeseriesBucket): string {
  const parts = [
    formatBucketFull(p.bucketStart, bucket),
    `${formatInt(p.requestCount)} requests`,
    `estimated ${formatUsd(formatMicroUsd(p.estimatedMicroUsd))}`,
    p.hasActual
      ? `actual ${formatUsd(formatMicroUsd(p.actualMicroUsd))}`
      : p.hasActivity
        ? "actual pending"
        : "no activity",
    `${formatInt(p.inputTokens)} input tokens`,
    `${formatInt(p.outputTokens)} output tokens`,
  ];
  if (p.pendingActualCostCount > 0) parts.push(`${p.pendingActualCostCount} pending reconciliation`);
  return parts.join(", ");
}
