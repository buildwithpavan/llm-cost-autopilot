import { afterEach, describe, expect, it, vi } from "vitest";

import {
  summaryToModelGroups,
  summaryToProviderGroups,
  summaryToTotals,
} from "../src/features/cost/cost-model";
import { getTelemetrySummary } from "../src/lib/api/telemetry";
import type {
  TelemetrySummaryMetrics,
  TelemetrySummaryModel,
  TelemetrySummaryProvider,
  TelemetrySummaryResponse,
} from "../src/lib/api/telemetry";

function metrics(over: Partial<TelemetrySummaryMetrics> = {}): TelemetrySummaryMetrics {
  return {
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: "0.000000",
    actualCostUsd: "0.000000",
    pendingActualCostCount: 0,
    ...over,
  };
}

describe("summaryToTotals", () => {
  it("adapts decimal-string costs into integer micro-USD and derives total tokens", () => {
    const t = summaryToTotals(
      metrics({
        requestCount: 7,
        inputTokens: 100,
        outputTokens: 40,
        estimatedCostUsd: "0.003500",
        actualCostUsd: "0.001100",
        pendingActualCostCount: 2,
      }),
    );
    expect(t.requestCount).toBe(7);
    expect(t.inputTokens).toBe(100);
    expect(t.outputTokens).toBe(40);
    expect(t.totalTokens).toBe(140);
    expect(t.estimatedMicroUsd).toBe(3500);
    expect(t.actualMicroUsd).toBe(1100);
    expect(t.pendingActualCostCount).toBe(2);
    // Event-level reconciliation is not sourced from the summary.
    expect(t.reconciledCount).toBe(0);
    expect(t.mismatchCount).toBe(0);
    expect(t.pendingReconciliationCount).toBe(0);
  });

  it("treats a zero/empty summary as a valid zero result (not null)", () => {
    const t = summaryToTotals(metrics({ estimatedCostUsd: "0", actualCostUsd: "0" }));
    expect(t.requestCount).toBe(0);
    expect(t.totalTokens).toBe(0);
    expect(t.estimatedMicroUsd).toBe(0);
    expect(t.actualMicroUsd).toBe(0);
    expect(t.pendingActualCostCount).toBe(0);
  });
});

describe("summaryToProviderGroups", () => {
  it("maps providers to CostGroups ordered by estimated cost desc then key asc", () => {
    const rows: TelemetrySummaryProvider[] = [
      { providerId: "b", ...metrics({ requestCount: 1, estimatedCostUsd: "0.001000" }) },
      { providerId: "a", ...metrics({ requestCount: 3, estimatedCostUsd: "0.003000" }) },
      { providerId: "c", ...metrics({ requestCount: 4, estimatedCostUsd: "0.003000" }) },
    ];
    const groups = summaryToProviderGroups(rows);
    // a and c tie on cost → key asc; b is cheapest → last.
    expect(groups.map((g) => g.key)).toEqual(["a", "c", "b"]);
    expect(groups[0]!.estimatedMicroUsd).toBe(3000);
    expect(groups[0]!.requestCount).toBe(3);
  });
});

describe("summaryToModelGroups", () => {
  it("preserves modelId-only grouping identity", () => {
    const rows: TelemetrySummaryModel[] = [
      { providerId: "p1", modelId: "m2", ...metrics({ estimatedCostUsd: "0.001000", inputTokens: 10 }) },
      { providerId: "p1", modelId: "m1", ...metrics({ estimatedCostUsd: "0.005000", outputTokens: 7 }) },
    ];
    const groups = summaryToModelGroups(rows);
    expect(groups.map((g) => g.key)).toEqual(["m1", "m2"]);
  });

  it("collapses the same modelId across providers with exact decimal-safe sums", () => {
    const rows: TelemetrySummaryModel[] = [
      {
        providerId: "p1",
        modelId: "shared",
        ...metrics({ requestCount: 2, inputTokens: 10, outputTokens: 5, estimatedCostUsd: "0.100000", actualCostUsd: "0.100000", pendingActualCostCount: 1 }),
      },
      {
        providerId: "p2",
        modelId: "shared",
        ...metrics({ requestCount: 3, inputTokens: 20, outputTokens: 6, estimatedCostUsd: "0.200000", actualCostUsd: "0.000000", pendingActualCostCount: 2 }),
      },
    ];
    const groups = summaryToModelGroups(rows);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.key).toBe("shared");
    expect(g.requestCount).toBe(5);
    expect(g.inputTokens).toBe(30);
    expect(g.outputTokens).toBe(11);
    expect(g.totalTokens).toBe(41);
    // 0.1 + 0.2 is exact in integer micro-USD (would drift as IEEE-754 floats).
    expect(g.estimatedMicroUsd).toBe(300_000);
    expect(g.actualMicroUsd).toBe(100_000);
    expect(g.pendingActualCostCount).toBe(3);
  });

  it("returns an empty array for an empty byModel", () => {
    expect(summaryToModelGroups([])).toEqual([]);
    expect(summaryToProviderGroups([])).toEqual([]);
  });
});

describe("getTelemetrySummary wrapper", () => {
  afterEach(() => vi.restoreAllMocks());

  function mockFetch(payload: TelemetrySummaryResponse) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }),
    );
  }

  const empty: TelemetrySummaryResponse = {
    window: { since: "s", until: "u" },
    totals: metrics(),
    byProvider: [],
    byModel: [],
  };

  it("builds the summary path with since/until/providerId/modelId", async () => {
    const spy = mockFetch(empty);
    await getTelemetrySummary({
      since: "2026-09-01T00:00:00.000Z",
      until: "2026-09-08T00:00:00.000Z",
      providerId: "openai",
      modelId: "openai:gpt-4o",
    });
    const url = String(spy.mock.calls[0]![0]);
    expect(url).toContain("/v1/telemetry/summary?");
    expect(url).toContain("since=2026-09-01T00%3A00%3A00.000Z");
    expect(url).toContain("until=2026-09-08T00%3A00%3A00.000Z");
    expect(url).toContain("providerId=openai");
    expect(url).toContain("modelId=openai%3Agpt-4o");
  });

  it("omits absent filters and returns parsed JSON", async () => {
    const spy = mockFetch(empty);
    const res = await getTelemetrySummary({ since: "s", until: "u" });
    const url = String(spy.mock.calls[0]![0]);
    expect(url).not.toContain("providerId=");
    expect(url).not.toContain("modelId=");
    expect(res).toEqual(empty);
  });
});
