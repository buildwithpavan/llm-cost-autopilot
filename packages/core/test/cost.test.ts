import { describe, expect, it } from "vitest";

import { Decimal } from "../src/cost/decimal.js";
import { isReconciled } from "../src/cost/reconcile.js";
import { estimateCostUsd } from "../src/cost/estimate.js";
import type { PricingTable } from "../src/types/catalog.js";

const TABLE: PricingTable = {
  versionId: "seed-2026-09-08",
  effectiveFrom: "2026-09-08T00:00:00.000Z",
  entries: [
    {
      providerId: "mock-cheap",
      modelId: "mock-cheap:small",
      unitInputUsdPerToken: "0.0000001",
      unitOutputUsdPerToken: "0.0000002",
      currency: "USD",
    },
    {
      providerId: "openai",
      modelId: "openai:gpt-4o-mini",
      unitInputUsdPerToken: "0.00000015",
      unitOutputUsdPerToken: "0.0000006",
      currency: "USD",
    },
  ],
};

describe("estimateCostUsd", () => {
  it("computes input * price_in + output * price_out for the requested model", () => {
    const cost = estimateCostUsd({
      table: TABLE,
      providerId: "openai",
      modelId: "openai:gpt-4o-mini",
      inputTokens: 1000,
      outputTokens: 500,
    });
    // 1000 * 0.00000015 = 0.00015; 500 * 0.0000006 = 0.0003; total = 0.00045
    expect(new Decimal(cost).eq(new Decimal("0.00045"))).toBe(true);
  });

  it("throws when the (provider, model) pair is not in the pricing table (FR-016)", () => {
    expect(() =>
      estimateCostUsd({
        table: TABLE,
        providerId: "mystery",
        modelId: "mystery:xl",
        inputTokens: 1,
        outputTokens: 1,
      }),
    ).toThrow(/no pricing entry/i);
  });

  it("rounds to 6 decimal places consistently (Principle V)", () => {
    const cost = estimateCostUsd({
      table: TABLE,
      providerId: "mock-cheap",
      modelId: "mock-cheap:small",
      inputTokens: 3,
      outputTokens: 7,
    });
    // 3 * 1e-7 + 7 * 2e-7 = 1.7e-6 → rounded to 6dp = 0.000002
    expect(cost).toBe("0.000002");
  });
});

describe("isReconciled (FR-019a)", () => {
  it("uses the percentage branch when actual is large", () => {
    // 5% branch dominates: 5% of 1.00 = 0.05, diff of 0.04 is within.
    expect(isReconciled({ estimatedUsd: "1.04", actualUsd: "1.00" })).toBe(true);
    // diff of 0.06 exceeds 0.05 → not reconciled.
    expect(isReconciled({ estimatedUsd: "1.06", actualUsd: "1.00" })).toBe(false);
  });

  it("uses the absolute branch when actual is tiny (< $0.02)", () => {
    // 5% of 0.001 = 0.00005 → absolute floor $0.001 dominates.
    // diff of 0.0009 must reconcile.
    expect(isReconciled({ estimatedUsd: "0.0019", actualUsd: "0.001" })).toBe(true);
    // diff of 0.002 exceeds floor → not reconciled.
    expect(isReconciled({ estimatedUsd: "0.003", actualUsd: "0.001" })).toBe(false);
  });

  it("is symmetric (est > actual and actual > est)", () => {
    expect(isReconciled({ estimatedUsd: "0.999", actualUsd: "1.000" })).toBe(true);
    expect(isReconciled({ estimatedUsd: "1.000", actualUsd: "0.999" })).toBe(true);
  });

  it("handles the exact boundary as reconciled", () => {
    // diff exactly equal to max($0.001, 5% * actual) should reconcile.
    expect(isReconciled({ estimatedUsd: "1.05", actualUsd: "1.00" })).toBe(true);
  });
});
