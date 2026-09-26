import { describe, expect, it } from "vitest";
import type { TelemetryEvent } from "@lca/core";
import type { CatalogResponse } from "../src/lib/api/catalog";
import type { HealthResponse } from "../src/lib/api/health";
import type { ReconciliationMetrics } from "../src/lib/api/metrics";
import {
  buildOverviewSections,
  deriveProviderStrip,
  deriveTrafficPulse,
  type Async,
} from "../src/features/overview/overview-model";

function ev(over: Partial<TelemetryEvent>): TelemetryEvent {
  return {
    decisionSource: "autopilot",
    terminalErrorClass: "none",
    receivedAt: "2026-09-08T00:00:00.000Z",
    eventId: "e",
    effectiveModelId: "mock-cheap:small",
    ...over,
  } as TelemetryEvent;
}

const CATALOG: CatalogResponse = {
  pricingTableVersionId: "seed-2026-09-08",
  models: [
    { providerId: "mock-cheap", modelId: "mock-cheap:small", qualityTier: "standard", capabilities: [], contextWindow: 8000 },
    { providerId: "mock-cheap", modelId: "mock-cheap:large", qualityTier: "high", capabilities: [], contextWindow: 32000 },
    { providerId: "mock-fast", modelId: "mock-fast:default", qualityTier: "standard", capabilities: [], contextWindow: 16000 },
  ],
};

const HEALTH: HealthResponse = {
  status: "ok",
  checks: { db: { ok: true }, providers: { ok: true, total: 3, healthy: 2 } },
};

const METRICS: ReconciliationMetrics = { rate: 0.97, alertActive: false };

describe("deriveTrafficPulse", () => {
  it("counts decision sources, failures, and rate over the event span", () => {
    const events = [
      ev({ decisionSource: "autopilot", receivedAt: "2026-09-08T00:00:00.000Z" }),
      ev({ decisionSource: "client_override", receivedAt: "2026-09-08T00:02:00.000Z" }),
      ev({ decisionSource: "operator_rule", terminalErrorClass: "timeout", receivedAt: "2026-09-08T00:04:00.000Z" }),
      ev({ decisionSource: "autopilot", receivedAt: "2026-09-08T00:06:00.000Z" }),
    ];
    const p = deriveTrafficPulse(events);
    expect(p.total).toBe(4);
    expect(p.autopilot).toBe(2);
    expect(p.clientOverride).toBe(1);
    expect(p.operatorRule).toBe(1);
    expect(p.failed).toBe(1);
    expect(p.autopilotShare).toBeCloseTo(0.5, 5);
    expect(p.overrideShare).toBeCloseTo(0.5, 5);
    expect(p.failureRate).toBeCloseTo(0.25, 5);
    expect(p.spanMinutes).toBeCloseTo(6, 5);
    expect(p.perMinute).toBeGreaterThan(0);
  });

  it("handles an empty event list without dividing by zero", () => {
    const p = deriveTrafficPulse([]);
    expect(p.total).toBe(0);
    expect(p.autopilotShare).toBe(0);
    expect(p.perMinute).toBe(0);
  });
});

describe("deriveProviderStrip", () => {
  it("lists distinct catalog providers and derives unhealthy count from health totals", () => {
    const s = deriveProviderStrip(CATALOG, HEALTH);
    expect(s.providers).toEqual(["mock-cheap", "mock-fast"]);
    expect(s.availableCount).toBe(2);
    expect(s.unhealthyCount).toBe(1);
  });

  it("leaves unhealthyCount null (never fabricated) when health totals are absent", () => {
    const s = deriveProviderStrip(CATALOG, null);
    expect(s.unhealthyCount).toBeNull();
  });

  it("does not crash and returns null when health omits a providers check (the real /v1/health shape)", () => {
    const realShape = { status: "ok", checks: { db: { ok: true } } } as unknown as HealthResponse;
    const s = deriveProviderStrip(CATALOG, realShape);
    expect(s.providers).toEqual(["mock-cheap", "mock-fast"]);
    expect(s.unhealthyCount).toBeNull();
  });
});

describe("buildOverviewSections", () => {
  const loading: Async<never> = { status: "loading" };
  const ready = {
    health: { status: "ready", data: HEALTH } as Async<HealthResponse>,
    events: { status: "ready", data: [ev({})] } as Async<readonly TelemetryEvent[]>,
    catalog: { status: "ready", data: CATALOG } as Async<CatalogResponse>,
    metrics: { status: "ready", data: METRICS } as Async<ReconciliationMetrics>,
  };

  it("normal populated data → all sections ready", () => {
    const s = buildOverviewSections(ready);
    expect(s.trafficPulse.kind).toBe("ready");
    expect(s.providerStrip.kind).toBe("ready");
    expect(s.latest.kind).toBe("ready");
    expect(s.pricing.kind).toBe("ready");
    expect(s.reconciliation.kind).toBe("ready");
    if (s.pricing.kind === "ready") expect(s.pricing.data.versionId).toBe("seed-2026-09-08");
  });

  it("loading → sections loading", () => {
    const s = buildOverviewSections({ health: loading, events: loading, catalog: loading, metrics: loading });
    expect(s.trafficPulse.kind).toBe("loading");
    expect(s.providerStrip.kind).toBe("loading");
    expect(s.reconciliation.kind).toBe("loading");
  });

  it("empty telemetry → traffic pulse and latest are empty", () => {
    const s = buildOverviewSections({ ...ready, events: { status: "ready", data: [] } });
    expect(s.trafficPulse.kind).toBe("empty");
    expect(s.latest.kind).toBe("empty");
    // Catalog-backed sections are unaffected by empty telemetry.
    expect(s.providerStrip.kind).toBe("ready");
    expect(s.pricing.kind).toBe("ready");
  });

  it("partial API failure → only the failed source's sections error", () => {
    const s = buildOverviewSections({ ...ready, catalog: { status: "error", message: "Catalog unavailable" } });
    expect(s.providerStrip.kind).toBe("error");
    expect(s.pricing.kind).toBe("error");
    // Telemetry-backed sections still render.
    expect(s.trafficPulse.kind).toBe("ready");
    expect(s.latest.kind).toBe("ready");
  });

  it("metrics missing → reconciliation ready but rate/alert are null (unavailable, not zero)", () => {
    const s = buildOverviewSections({
      ...ready,
      metrics: { status: "ready", data: { rate: null, alertActive: null } },
    });
    expect(s.reconciliation.kind).toBe("ready");
    if (s.reconciliation.kind === "ready") {
      expect(s.reconciliation.data.rate).toBeNull();
      expect(s.reconciliation.data.alertActive).toBeNull();
    }
  });

  it("metrics endpoint failure → reconciliation section errors", () => {
    const s = buildOverviewSections({ ...ready, metrics: { status: "error", message: "Metrics unavailable" } });
    expect(s.reconciliation.kind).toBe("error");
  });
});
