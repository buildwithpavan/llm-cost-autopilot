import { describe, expect, it } from "vitest";

import type { TimeseriesResponse } from "../src/lib/api/telemetry";
import {
  toTrendPoints,
  bucketForRange,
  metricMax,
  metricValue,
  hasAnyActivity,
  formatMetricMax,
  formatBucketLabel,
  formatBucketFull,
  trendBucketDetail,
  bucketAriaLabel,
} from "../src/features/cost/timeseries-model";

const RES: TimeseriesResponse = {
  window: { since: "2026-10-05T10:00:00.000Z", until: "2026-10-05T13:00:00.000Z" },
  bucket: "hour",
  buckets: [
    // reconciled + pending mix
    { bucketStart: "2026-10-05T10:00:00Z", requestCount: 2, inputTokens: 30, outputTokens: 15, estimatedCostUsd: "0.000030", actualCostUsd: "0.000010", pendingActualCostCount: 1, reconciledCount: 1 },
    // fully pending (no actual yet)
    { bucketStart: "2026-10-05T11:00:00Z", requestCount: 1, inputTokens: 40, outputTokens: 20, estimatedCostUsd: "0.000040", actualCostUsd: "0", pendingActualCostCount: 1, reconciledCount: 0 },
    // zero-activity gap
    { bucketStart: "2026-10-05T12:00:00Z", requestCount: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: "0", actualCostUsd: "0", pendingActualCostCount: 0, reconciledCount: 0 },
  ],
};

describe("toTrendPoints", () => {
  const pts = toTrendPoints(RES);

  it("preserves exact decimal strings and parses exact micro-USD", () => {
    expect(pts[0]!.estimatedCostUsd).toBe("0.000030");
    expect(pts[0]!.actualCostUsd).toBe("0.000010");
    expect(pts[0]!.estimatedMicroUsd).toBe(30);
    expect(pts[0]!.actualMicroUsd).toBe(10);
  });

  it("marks actual present only when a request reconciled", () => {
    expect(pts[0]!.hasActual).toBe(true); // 2 requests, 1 pending → 1 reconciled
    expect(pts[1]!.hasActual).toBe(false); // 1 request, 1 pending → 0 reconciled
    expect(pts[2]!.hasActual).toBe(false); // no activity
  });

  it("computes totals and activity flags", () => {
    expect(pts[0]!.totalTokens).toBe(45);
    expect(pts[0]!.hasActivity).toBe(true);
    expect(pts[2]!.hasActivity).toBe(false);
  });

  it("keeps zero buckets (does not drop gaps)", () => {
    expect(pts).toHaveLength(3);
    expect(pts[2]!.requestCount).toBe(0);
    expect(pts[2]!.estimatedMicroUsd).toBe(0);
  });
});

describe("bucketForRange", () => {
  it("is hourly for 24h and daily otherwise", () => {
    expect(bucketForRange("24h")).toBe("hour");
    expect(bucketForRange("7d")).toBe("day");
    expect(bucketForRange("30d")).toBe("day");
  });
});

describe("metric selection", () => {
  const pts = toTrendPoints(RES);
  it("selects the right per-point value", () => {
    expect(metricValue(pts[0]!, "requests")).toBe(2);
    expect(metricValue(pts[0]!, "tokens")).toBe(45);
    expect(metricValue(pts[1]!, "cost")).toBe(40); // max(estimated 40, actual 0)
  });
  it("computes the metric max over all points", () => {
    expect(metricMax(pts, "cost")).toBe(40);
    expect(metricMax(pts, "requests")).toBe(2);
    expect(metricMax(pts, "tokens")).toBe(60);
  });
  it("detects any activity", () => {
    expect(hasAnyActivity(pts)).toBe(true);
    expect(hasAnyActivity([pts[2]!])).toBe(false);
  });
  it("formats the metric max per unit", () => {
    expect(formatMetricMax(40, "cost")).toContain("$");
    expect(formatMetricMax(2, "requests")).toBe("2");
    expect(formatMetricMax(1500, "tokens")).toBe("1.5K");
  });
});

describe("UTC bucket formatting", () => {
  it("formats hour and day labels deterministically in UTC", () => {
    expect(formatBucketLabel("2026-10-05T10:00:00Z", "hour")).toBe("10:00");
    expect(formatBucketLabel("2026-10-05T00:00:00Z", "day")).toBe("Oct 5");
    expect(formatBucketFull("2026-10-05T10:00:00Z", "hour")).toBe("Oct 5, 10:00 UTC");
    expect(formatBucketFull("2026-10-05T00:00:00Z", "day")).toBe("Oct 5, 2026");
  });
});

describe("trendBucketDetail", () => {
  const pts = toTrendPoints(RES);
  it("shows actual cost when reconciled and pending note when pending", () => {
    const d = trendBucketDetail(pts[0]!, "hour", "cost");
    expect(d.estimatedCost).toContain("$");
    expect(d.actualCost).not.toBeNull();
    expect(d.pendingNote).toBe("1 pending reconciliation");
    expect(d.requests).toBe("2");
  });
  it("does not imply an actual value when fully pending", () => {
    const d = trendBucketDetail(pts[1]!, "hour", "cost");
    expect(d.actualCost).toBeNull();
    expect(d.pendingNote).toBe("1 pending reconciliation");
  });
});

describe("bucketAriaLabel", () => {
  const pts = toTrendPoints(RES);
  it("includes time, requests, costs and tokens without color reliance", () => {
    const a = bucketAriaLabel(pts[0]!, "hour");
    expect(a).toContain("Oct 5, 10:00 UTC");
    expect(a).toContain("2 requests");
    expect(a).toContain("estimated");
    expect(a).toContain("actual");
    expect(a).toContain("input tokens");
    expect(a).toContain("output tokens");
  });
  it("says pending (not a fabricated actual) for fully pending buckets", () => {
    expect(bucketAriaLabel(pts[1]!, "hour")).toContain("actual pending");
  });
  it("says no activity for zero buckets", () => {
    expect(bucketAriaLabel(pts[2]!, "hour")).toContain("no activity");
  });
});
