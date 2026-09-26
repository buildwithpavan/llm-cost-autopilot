import type { TelemetryEvent } from "../../types/index.js";
import type { CatalogResponse } from "../../lib/api/catalog.js";
import type { HealthResponse } from "../../lib/api/health.js";
import type { ReconciliationMetrics } from "../../lib/api/metrics.js";

/** Async result for an independent Overview data source (partial-failure friendly). */
export type Async<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

/** Per-section render state derived from the raw sources. */
export type SectionState<T> =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "ready"; data: T };

export interface TrafficPulse {
  total: number;
  autopilot: number;
  clientOverride: number;
  operatorRule: number;
  failed: number;
  autopilotShare: number;
  overrideShare: number;
  failureRate: number;
  spanMinutes: number;
  perMinute: number;
}

/** Traffic pulse derived from persisted telemetry (NOT from /metrics, which has no request-rate series). */
export function deriveTrafficPulse(events: readonly TelemetryEvent[]): TrafficPulse {
  const total = events.length;
  let autopilot = 0;
  let clientOverride = 0;
  let operatorRule = 0;
  let failed = 0;
  let minT = Number.POSITIVE_INFINITY;
  let maxT = Number.NEGATIVE_INFINITY;
  for (const e of events) {
    if (e.decisionSource === "autopilot") autopilot++;
    else if (e.decisionSource === "client_override") clientOverride++;
    else if (e.decisionSource === "operator_rule") operatorRule++;
    if (e.terminalErrorClass !== "none") failed++;
    const t = Date.parse(e.receivedAt);
    if (!Number.isNaN(t)) {
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
  }
  const spanMs = total > 1 && maxT > minT ? maxT - minT : 0;
  const spanMinutes = spanMs / 60_000;
  return {
    total,
    autopilot,
    clientOverride,
    operatorRule,
    failed,
    autopilotShare: total ? autopilot / total : 0,
    overrideShare: total ? (clientOverride + operatorRule) / total : 0,
    failureRate: total ? failed / total : 0,
    spanMinutes,
    perMinute: spanMinutes > 0 ? total / spanMinutes : 0,
  };
}

export interface ProviderStrip {
  /** Distinct providers present in the catalog — i.e. currently healthy/available (catalog excludes unhealthy). */
  providers: string[];
  availableCount: number;
  /** Unhealthy provider count from /v1/health if it exposes totals; null when not derivable (never fabricated). */
  unhealthyCount: number | null;
}

export function deriveProviderStrip(
  catalog: CatalogResponse,
  health: HealthResponse | null,
): ProviderStrip {
  const providers = [...new Set(catalog.models.map((m) => m.providerId))].sort();
  // /v1/health does not currently expose per-provider totals; read defensively
  // and leave unhealthyCount null when absent rather than fabricating a value.
  const providersCheck = (health?.checks as { providers?: { total?: number; healthy?: number } } | undefined)
    ?.providers;
  const total = providersCheck?.total;
  const healthy = providersCheck?.healthy;
  const unhealthyCount =
    typeof total === "number" && typeof healthy === "number" ? Math.max(0, total - healthy) : null;
  return { providers, availableCount: providers.length, unhealthyCount };
}

export interface PricingSummary {
  versionId: string;
  /** effective-since is NOT exposed by /v1/catalog; the view shows this as an explicit limitation. */
  effectiveSinceAvailable: false;
}

export interface OverviewInputs {
  health: Async<HealthResponse>;
  events: Async<readonly TelemetryEvent[]>;
  catalog: Async<CatalogResponse>;
  metrics: Async<ReconciliationMetrics>;
}

export interface OverviewSections {
  trafficPulse: SectionState<TrafficPulse>;
  providerStrip: SectionState<ProviderStrip>;
  latest: SectionState<readonly TelemetryEvent[]>;
  pricing: SectionState<PricingSummary>;
  reconciliation: SectionState<ReconciliationMetrics>;
}

/** Pure mapping from raw async sources → per-section states. Each section fails/loads independently. */
export function buildOverviewSections(inputs: OverviewInputs): OverviewSections {
  return {
    trafficPulse: mapSection(inputs.events, (events) =>
      events.length === 0 ? empty() : ready(deriveTrafficPulse(events)),
    ),
    providerStrip: mapSection(inputs.catalog, (catalog) =>
      catalog.models.length === 0
        ? empty()
        : ready(deriveProviderStrip(catalog, inputs.health.status === "ready" ? inputs.health.data : null)),
    ),
    latest: mapSection(inputs.events, (events) =>
      events.length === 0 ? empty() : ready(events),
    ),
    pricing: mapSection(inputs.catalog, (catalog) =>
      ready<PricingSummary>({ versionId: catalog.pricingTableVersionId, effectiveSinceAvailable: false }),
    ),
    // "ready" even when rate/alert are null; the null values encode "unavailable" (distinct from 0).
    reconciliation: mapSection(inputs.metrics, (m) => ready(m)),
  };
}

function mapSection<S, T>(
  source: Async<S>,
  onReady: (data: S) => SectionState<T>,
): SectionState<T> {
  if (source.status === "loading") return { kind: "loading" };
  if (source.status === "error") return { kind: "error", message: source.message };
  return onReady(source.data);
}

function ready<T>(data: T): SectionState<T> {
  return { kind: "ready", data };
}
function empty<T>(): SectionState<T> {
  return { kind: "empty" };
}
