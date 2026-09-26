import type { TelemetryEvent } from "../../types/index.js";

/* ------------------------------------------------------------------ *
 * Decimal-safe USD arithmetic in integer micro-USD (1e-6 USD).
 * Backend costs are 6-decimal USD strings; we never float-accumulate.
 * JS integers are exact below 2^53, i.e. up to ~9e9 USD in micro-USD.
 * ------------------------------------------------------------------ */

/** Parse a 6-decimal USD string into integer micro-USD. null/invalid → 0. */
export function parseMicroUsd(usd: string | null | undefined): number {
  if (usd === null || usd === undefined) return 0;
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(usd.trim());
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const whole = Number(m[2]);
  const frac = ((m[3] ?? "") + "000000").slice(0, 6);
  return sign * (whole * 1_000_000 + Number(frac));
}

/** Format integer micro-USD back to a 6-decimal USD string (for display formatters). */
export function formatMicroUsd(micro: number): string {
  const sign = micro < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(micro));
  const whole = Math.floor(abs / 1_000_000);
  const frac = String(abs % 1_000_000).padStart(6, "0");
  return `${sign}${whole}.${frac}`;
}

/* ------------------------------------------------------------------ *
 * Pure aggregations over a fetched event window.
 * All money is carried as integer micro-USD; callers format for display.
 * ------------------------------------------------------------------ */

export interface CostTotals {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedMicroUsd: number;
  /** Sum of non-null actualCostUsd only. */
  actualMicroUsd: number;
  /** Events whose actualCostUsd is null (actual cost not yet reconciled). */
  pendingActualCostCount: number;
  /** Event-level context only — NOT the authoritative reconciliation rate. */
  reconciledCount: number;
  mismatchCount: number;
  pendingReconciliationCount: number;
}

export function deriveCostTotals(events: readonly TelemetryEvent[]): CostTotals {
  const t: CostTotals = {
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedMicroUsd: 0,
    actualMicroUsd: 0,
    pendingActualCostCount: 0,
    reconciledCount: 0,
    mismatchCount: 0,
    pendingReconciliationCount: 0,
  };
  for (const e of events) {
    t.requestCount += 1;
    t.inputTokens += e.aggregatedInputTokens;
    t.outputTokens += e.aggregatedOutputTokens;
    t.estimatedMicroUsd += parseMicroUsd(e.estimatedCostUsd);
    if (e.actualCostUsd === null) {
      t.pendingActualCostCount += 1;
    } else {
      t.actualMicroUsd += parseMicroUsd(e.actualCostUsd);
    }
    if (e.reconciled === null) t.pendingReconciliationCount += 1;
    else if (e.reconciled) t.reconciledCount += 1;
    else t.mismatchCount += 1;
  }
  t.totalTokens = t.inputTokens + t.outputTokens;
  return t;
}

export interface CostGroup {
  key: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedMicroUsd: number;
  actualMicroUsd: number;
  pendingActualCostCount: number;
}

/** Fallback label when a backend identity is unexpectedly absent (never inferred). */
export const UNKNOWN_KEY = "(unknown)";

function groupBy(
  events: readonly TelemetryEvent[],
  keyOf: (e: TelemetryEvent) => string,
): CostGroup[] {
  const map = new Map<string, CostGroup>();
  for (const e of events) {
    const rawKey = keyOf(e);
    const key = rawKey && rawKey.length > 0 ? rawKey : UNKNOWN_KEY;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedMicroUsd: 0,
        actualMicroUsd: 0,
        pendingActualCostCount: 0,
      };
      map.set(key, g);
    }
    g.requestCount += 1;
    g.inputTokens += e.aggregatedInputTokens;
    g.outputTokens += e.aggregatedOutputTokens;
    g.totalTokens += e.aggregatedInputTokens + e.aggregatedOutputTokens;
    g.estimatedMicroUsd += parseMicroUsd(e.estimatedCostUsd);
    if (e.actualCostUsd === null) g.pendingActualCostCount += 1;
    else g.actualMicroUsd += parseMicroUsd(e.actualCostUsd);
  }
  // Deterministic: estimated cost desc, then key asc as a stable tie-break.
  return [...map.values()].sort(
    (a, b) => b.estimatedMicroUsd - a.estimatedMicroUsd || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

export function deriveProviderCost(events: readonly TelemetryEvent[]): CostGroup[] {
  return groupBy(events, (e) => e.effectiveProviderId);
}

export function deriveModelCost(events: readonly TelemetryEvent[]): CostGroup[] {
  return groupBy(events, (e) => e.effectiveModelId);
}

export interface ReconciliationSummary {
  reconciled: number;
  mismatch: number;
  pending: number;
  total: number;
}

/** Event-level reconciliation counts over the fetched window (contextual, not authoritative). */
export function deriveReconciliationSummary(events: readonly TelemetryEvent[]): ReconciliationSummary {
  let reconciled = 0;
  let mismatch = 0;
  let pending = 0;
  for (const e of events) {
    if (e.reconciled === null) pending += 1;
    else if (e.reconciled) reconciled += 1;
    else mismatch += 1;
  }
  return { reconciled, mismatch, pending, total: events.length };
}
