import { describe, expect, it } from "vitest";
import type { TelemetryEvent } from "../src/types";
import {
  deriveCostTotals,
  deriveModelCost,
  deriveProviderCost,
  deriveReconciliationSummary,
  formatMicroUsd,
  parseMicroUsd,
  UNKNOWN_KEY,
} from "../src/features/cost/cost-model";

function ev(over: Partial<TelemetryEvent>): TelemetryEvent {
  return {
    eventId: "e",
    receivedAt: "2026-09-08T00:00:00.000Z",
    clientId: "acme",
    decisionSource: "autopilot",
    shadowedSource: null,
    effectiveProviderId: "mock-cheap",
    effectiveModelId: "mock-cheap:small",
    attempts: [] as unknown as TelemetryEvent["attempts"],
    aggregatedInputTokens: 0,
    aggregatedOutputTokens: 0,
    totalLatencyMs: 0,
    terminalErrorClass: "none",
    estimatedCostUsd: "0.000000",
    actualCostUsd: null,
    pricingTableVersionId: "seed-2026-09-08",
    reconciled: null,
    routingRationale: {} as unknown as TelemetryEvent["routingRationale"],
    ...over,
  };
}

describe("parseMicroUsd / formatMicroUsd", () => {
  it("parses zero", () => {
    expect(parseMicroUsd("0.000000")).toBe(0);
    expect(formatMicroUsd(0)).toBe("0.000000");
  });

  it("parses a single 6-decimal value", () => {
    expect(parseMicroUsd("0.001234")).toBe(1234);
    expect(parseMicroUsd("1.500000")).toBe(1_500_000);
    expect(parseMicroUsd("12")).toBe(12_000_000);
  });

  it("treats null/invalid as 0", () => {
    expect(parseMicroUsd(null)).toBe(0);
    expect(parseMicroUsd(undefined)).toBe(0);
    expect(parseMicroUsd("")).toBe(0);
    expect(parseMicroUsd("abc")).toBe(0);
  });

  it("sums values whose float representation would drift, without drift", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754, but integer micro-USD is exact.
    const micro = parseMicroUsd("0.100000") + parseMicroUsd("0.200000");
    expect(micro).toBe(300_000);
    expect(formatMicroUsd(micro)).toBe("0.300000");
  });

  it("sums many small values exactly", () => {
    let micro = 0;
    for (let i = 0; i < 3; i++) micro += parseMicroUsd("0.000001");
    expect(micro).toBe(3);
    expect(formatMicroUsd(micro)).toBe("0.000003");
  });

  it("round-trips a formatted total", () => {
    const micro = parseMicroUsd("2.345678") + parseMicroUsd("0.654322");
    expect(formatMicroUsd(micro)).toBe("3.000000");
  });
});

describe("deriveCostTotals", () => {
  it("sums counts, tokens, estimated and actual cost, and pending", () => {
    const t = deriveCostTotals([
      ev({ aggregatedInputTokens: 100, aggregatedOutputTokens: 20, estimatedCostUsd: "0.001000", actualCostUsd: "0.001100", reconciled: true }),
      ev({ aggregatedInputTokens: 50, aggregatedOutputTokens: 10, estimatedCostUsd: "0.002000", actualCostUsd: null, reconciled: null }),
      ev({ aggregatedInputTokens: 5, aggregatedOutputTokens: 5, estimatedCostUsd: "0.000500", actualCostUsd: "0.010000", reconciled: false }),
    ]);
    expect(t.requestCount).toBe(3);
    expect(t.inputTokens).toBe(155);
    expect(t.outputTokens).toBe(35);
    expect(t.totalTokens).toBe(190);
    expect(formatMicroUsd(t.estimatedMicroUsd)).toBe("0.003500");
    expect(formatMicroUsd(t.actualMicroUsd)).toBe("0.011100");
    expect(t.pendingActualCostCount).toBe(1);
    expect(t.reconciledCount).toBe(1);
    expect(t.mismatchCount).toBe(1);
    expect(t.pendingReconciliationCount).toBe(1);
  });

  it("excludes null actual cost from the actual sum but counts it pending", () => {
    const t = deriveCostTotals([
      ev({ estimatedCostUsd: "0.005000", actualCostUsd: null }),
      ev({ estimatedCostUsd: "0.005000", actualCostUsd: null }),
    ]);
    expect(t.actualMicroUsd).toBe(0);
    expect(t.pendingActualCostCount).toBe(2);
    expect(formatMicroUsd(t.estimatedMicroUsd)).toBe("0.010000");
  });

  it("returns zeros for an empty window", () => {
    const t = deriveCostTotals([]);
    expect(t).toEqual({
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
    });
  });

  it("reflects only the provided window (no global/all-time state)", () => {
    const all = [
      ev({ estimatedCostUsd: "1.000000" }),
      ev({ estimatedCostUsd: "2.000000" }),
      ev({ estimatedCostUsd: "4.000000" }),
    ];
    expect(formatMicroUsd(deriveCostTotals(all.slice(0, 2)).estimatedMicroUsd)).toBe("3.000000");
    expect(formatMicroUsd(deriveCostTotals(all).estimatedMicroUsd)).toBe("7.000000");
  });
});

describe("deriveProviderCost", () => {
  it("groups by provider and orders by estimated cost desc then key asc", () => {
    const groups = deriveProviderCost([
      ev({ effectiveProviderId: "b", estimatedCostUsd: "0.001000" }),
      ev({ effectiveProviderId: "a", estimatedCostUsd: "0.003000" }),
      ev({ effectiveProviderId: "a", estimatedCostUsd: "0.001000" }),
      ev({ effectiveProviderId: "c", estimatedCostUsd: "0.004000" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["a", "c", "b"]);
    const a = groups.find((g) => g.key === "a")!;
    expect(a.requestCount).toBe(2);
    expect(formatMicroUsd(a.estimatedMicroUsd)).toBe("0.004000");
  });

  it("uses a stable secondary key for equal estimated costs", () => {
    const groups = deriveProviderCost([
      ev({ effectiveProviderId: "zeta", estimatedCostUsd: "0.001000" }),
      ev({ effectiveProviderId: "alpha", estimatedCostUsd: "0.001000" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["alpha", "zeta"]);
  });

  it("falls back to a neutral key when provider identity is empty (never inferred)", () => {
    const groups = deriveProviderCost([ev({ effectiveProviderId: "", estimatedCostUsd: "0.001000" })]);
    expect(groups[0]!.key).toBe(UNKNOWN_KEY);
  });
});

describe("deriveModelCost", () => {
  it("groups by model with deterministic ordering", () => {
    const groups = deriveModelCost([
      ev({ effectiveModelId: "m2", estimatedCostUsd: "0.001000", aggregatedInputTokens: 10 }),
      ev({ effectiveModelId: "m1", estimatedCostUsd: "0.005000", aggregatedOutputTokens: 7 }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["m1", "m2"]);
    expect(groups[1]!.totalTokens).toBe(10);
    expect(groups[0]!.totalTokens).toBe(7);
  });
});

describe("deriveReconciliationSummary", () => {
  it("counts event-level reconciled/mismatch/pending", () => {
    const s = deriveReconciliationSummary([
      ev({ reconciled: true }),
      ev({ reconciled: true }),
      ev({ reconciled: false }),
      ev({ reconciled: null }),
    ]);
    expect(s).toEqual({ reconciled: 2, mismatch: 1, pending: 1, total: 4 });
  });

  it("handles an empty window", () => {
    expect(deriveReconciliationSummary([])).toEqual({ reconciled: 0, mismatch: 0, pending: 0, total: 0 });
  });
});
