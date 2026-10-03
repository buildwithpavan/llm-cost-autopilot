import { afterEach, describe, expect, it, vi } from "vitest";

import { getTelemetryAnomalies, type AnomaliesResponse } from "../src/lib/api/telemetry";

const payload: AnomaliesResponse = {
  window: { since: "2026-10-01T00:00:00.000Z", until: "2026-10-01T09:00:00.000Z" },
  bucket: "hour",
  thresholds: { minHistory: 6, relThreshold: "0.5", criticalRelThreshold: "1", minAbsoluteUsd: "0.010000" },
  anomalies: [
    {
      bucketStart: "2026-10-01T08:00:00Z",
      estimatedCostUsd: "0.160000",
      baselineEstimatedCostUsd: "0.100000",
      deviationUsd: "0.060000",
      deviationPercent: "60.00",
      historicalBucketCount: 8,
      severity: "warning",
    },
  ],
};

describe("getTelemetryAnomalies wrapper", () => {
  afterEach(() => vi.restoreAllMocks());

  function mockFetch(body: AnomaliesResponse) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
    );
  }

  it("builds the query from since/until/bucket/provider/model and sends the bearer key", async () => {
    const spy = mockFetch(payload);
    await getTelemetryAnomalies({
      since: "2026-10-01T00:00:00.000Z",
      until: "2026-10-01T09:00:00.000Z",
      bucket: "hour",
      providerId: "pA",
      modelId: "mA",
      apiKey: "secret-key",
    });
    const [url, init] = spy.mock.calls[0]!;
    const u = new URL(String(url), "http://x");
    expect(u.pathname).toBe("/v1/telemetry/anomalies");
    expect(u.searchParams.get("since")).toBe("2026-10-01T00:00:00.000Z");
    expect(u.searchParams.get("until")).toBe("2026-10-01T09:00:00.000Z");
    expect(u.searchParams.get("bucket")).toBe("hour");
    expect(u.searchParams.get("providerId")).toBe("pA");
    expect(u.searchParams.get("modelId")).toBe("mA");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer secret-key");
  });

  it("omits unset filters and clientId", async () => {
    const spy = mockFetch(payload);
    await getTelemetryAnomalies({ since: "a", until: "b", bucket: "day" });
    const u = new URL(String(spy.mock.calls[0]![0]), "http://x");
    expect(u.searchParams.has("providerId")).toBe(false);
    expect(u.searchParams.has("modelId")).toBe(false);
    expect(u.searchParams.has("clientId")).toBe(false);
  });

  it("forwards the abort signal", async () => {
    const spy = mockFetch(payload);
    const ctrl = new AbortController();
    await getTelemetryAnomalies({ signal: ctrl.signal });
    const init = spy.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBe(ctrl.signal);
  });

  it("preserves monetary + deviation values as exact decimal strings (never Number)", async () => {
    mockFetch(payload);
    const res = await getTelemetryAnomalies({ bucket: "hour" });
    const a = res.anomalies[0]!;
    expect(a.estimatedCostUsd).toBe("0.160000");
    expect(a.baselineEstimatedCostUsd).toBe("0.100000");
    expect(a.deviationUsd).toBe("0.060000");
    expect(a.deviationPercent).toBe("60.00");
    expect(typeof a.deviationUsd).toBe("string");
  });
});
