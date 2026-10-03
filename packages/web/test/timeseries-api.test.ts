import { afterEach, describe, expect, it, vi } from "vitest";

import { getTelemetryTimeseries, type TimeseriesResponse } from "../src/lib/api/telemetry";

const payload: TimeseriesResponse = {
  window: { since: "2026-10-05T10:00:00.000Z", until: "2026-10-05T12:00:00.000Z" },
  bucket: "hour",
  buckets: [
    {
      bucketStart: "2026-10-05T10:00:00Z",
      requestCount: 2,
      inputTokens: 30,
      outputTokens: 15,
      estimatedCostUsd: "0.000030",
      actualCostUsd: "0.000010",
      pendingActualCostCount: 1,
      reconciledCount: 1,
    },
  ],
};

describe("getTelemetryTimeseries wrapper", () => {
  afterEach(() => vi.restoreAllMocks());

  function mockFetch(body: TimeseriesResponse) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
    );
  }

  it("builds the query from since/until/bucket/provider/model and sends the bearer key", async () => {
    const spy = mockFetch(payload);
    await getTelemetryTimeseries({
      since: "2026-10-05T10:00:00.000Z",
      until: "2026-10-05T12:00:00.000Z",
      bucket: "hour",
      providerId: "mock-cheap",
      modelId: "mock-cheap:small",
      apiKey: "secret-key",
    });
    const [url, init] = spy.mock.calls[0]!;
    const u = new URL(String(url), "http://x");
    expect(u.pathname).toBe("/v1/telemetry/timeseries");
    expect(u.searchParams.get("since")).toBe("2026-10-05T10:00:00.000Z");
    expect(u.searchParams.get("until")).toBe("2026-10-05T12:00:00.000Z");
    expect(u.searchParams.get("bucket")).toBe("hour");
    expect(u.searchParams.get("providerId")).toBe("mock-cheap");
    expect(u.searchParams.get("modelId")).toBe("mock-cheap:small");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer secret-key");
  });

  it("omits unset filters and clientId", async () => {
    const spy = mockFetch(payload);
    await getTelemetryTimeseries({ since: "a", until: "b", bucket: "day" });
    const u = new URL(String(spy.mock.calls[0]![0]), "http://x");
    expect(u.searchParams.has("providerId")).toBe(false);
    expect(u.searchParams.has("modelId")).toBe(false);
    expect(u.searchParams.has("clientId")).toBe(false);
  });

  it("supports clientId for contract completeness when explicitly provided", async () => {
    const spy = mockFetch(payload);
    await getTelemetryTimeseries({ clientId: "acme" });
    const u = new URL(String(spy.mock.calls[0]![0]), "http://x");
    expect(u.searchParams.get("clientId")).toBe("acme");
  });

  it("forwards the abort signal", async () => {
    const spy = mockFetch(payload);
    const ctrl = new AbortController();
    await getTelemetryTimeseries({ signal: ctrl.signal });
    const init = spy.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBe(ctrl.signal);
  });

  it("preserves monetary values as exact decimal strings (never Number)", async () => {
    mockFetch(payload);
    const res = await getTelemetryTimeseries({ bucket: "hour" });
    expect(res.buckets[0]!.estimatedCostUsd).toBe("0.000030");
    expect(res.buckets[0]!.actualCostUsd).toBe("0.000010");
    expect(typeof res.buckets[0]!.estimatedCostUsd).toBe("string");
  });
});
