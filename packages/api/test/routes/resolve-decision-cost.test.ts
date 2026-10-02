import { describe, expect, it } from "vitest";

import { cost, type Model, type NormalizedRequest, type OperatorRule, type PricingTable } from "@lca/core";

import { resolveRoutingDecision } from "../../src/routing/resolve-decision.js";
import type { CatalogSnapshot } from "../../src/wiring.js";

const PA: Model = {
  providerId: "pa",
  modelId: "pa:m",
  capabilities: ["json_mode"],
  contextWindow: 100_000,
  qualityTier: "standard",
  publishedLatencyProfile: { p50Ms: 100, p95Ms: 300 },
  publishedReliabilityScore: 0.99,
  pricingDescriptorRef: "pa:m",
};
const PB: Model = {
  ...PA,
  providerId: "pb",
  modelId: "pb:m",
  pricingDescriptorRef: "pb:m",
};

const TABLE: PricingTable = {
  versionId: "cost-test-v1",
  effectiveFrom: "2026-10-01T00:00:00.000Z",
  entries: [
    { providerId: "pa", modelId: "pa:m", unitInputUsdPerToken: "0.000001", unitOutputUsdPerToken: "0.000002", currency: "USD" },
    { providerId: "pb", modelId: "pb:m", unitInputUsdPerToken: "0.000010", unitOutputUsdPerToken: "0.000020", currency: "USD" },
  ],
};

const SNAPSHOT: CatalogSnapshot = { models: [PA, PB], pricingTable: TABLE };

function req(over: Partial<NormalizedRequest> = {}): NormalizedRequest {
  return {
    requestId: "r1",
    clientId: "acme",
    receivedAt: "2026-10-02T00:00:00.000Z",
    messages: [{ role: "user", content: "hi" }],
    requirements: { requiredCapabilities: [] },
    override: null,
    estimatedInputTokens: 100,
    ...over,
  };
}

function rule(pin: { providerId: string | null; modelId: string | null }): OperatorRule {
  return {
    ruleId: "rule_x",
    priority: 10,
    enabled: true,
    match: { clientIds: null, requiredCapabilities: null, minEstimatedTokens: null, maxEstimatedTokens: null },
    pin,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

// Same heuristic decide.ts uses for the output-token estimate.
function expectedCost(providerId: string, modelId: string): string {
  const inputTokens = 100;
  const outputTokens = Math.max(4, Math.floor(inputTokens / 4));
  return cost.estimateCostUsd({ table: TABLE, providerId, modelId, inputTokens, outputTokens });
}

describe("routing decision cost basis", () => {
  it("autopilot decision carries the estimator's cost for the chosen model", () => {
    const { decision } = resolveRoutingDecision({ request: req(), rules: [], snapshot: SNAPSHOT });
    expect(decision.decisionSource).toBe("autopilot");
    // Cheapest model wins (cost weight dominates).
    expect(decision.chosenModelId).toBe("pa:m");
    expect(decision.estimatedCostUsd).toBe(expectedCost("pa", "pa:m"));
    expect(decision.estimatedCostUsd).not.toBe("0");
  });

  it("client override is priced for the pinned model (not zero)", () => {
    const { decision } = resolveRoutingDecision({
      request: req({ override: { providerId: "pb", modelId: "pb:m" } }),
      rules: [],
      snapshot: SNAPSHOT,
    });
    expect(decision.decisionSource).toBe("client_override");
    expect(decision.estimatedCostUsd).toBe(expectedCost("pb", "pb:m"));
    expect(decision.estimatedCostUsd).not.toBe("0");
  });

  it("operator rule is priced for the pinned model (not zero)", () => {
    const { decision } = resolveRoutingDecision({
      request: req(),
      rules: [rule({ providerId: "pb", modelId: "pb:m" })],
      snapshot: SNAPSHOT,
    });
    expect(decision.decisionSource).toBe("operator_rule");
    expect(decision.estimatedCostUsd).toBe(expectedCost("pb", "pb:m"));
  });

  it("explicit provider/model pin is priced for that exact target", () => {
    const { decision } = resolveRoutingDecision({
      request: req({ override: { providerId: "pa", modelId: "pa:m" } }),
      rules: [],
      snapshot: SNAPSHOT,
    });
    expect(decision.chosenModelId).toBe("pa:m");
    expect(decision.estimatedCostUsd).toBe(expectedCost("pa", "pa:m"));
  });

  it("produces identical cost across repeated resolutions (preview/completion parity)", () => {
    const input = { request: req({ override: { providerId: "pb", modelId: "pb:m" } }), rules: [], snapshot: SNAPSHOT };
    const a = resolveRoutingDecision(input).decision.estimatedCostUsd;
    const b = resolveRoutingDecision(input).decision.estimatedCostUsd;
    expect(a).toBe(b);
    expect(a).toBe(expectedCost("pb", "pb:m"));
  });

  it("preserves invalid-target semantics for an unpriceable/absent pin", () => {
    expect(() =>
      resolveRoutingDecision({
        request: req({ override: { providerId: "px", modelId: "px:m" } }),
        rules: [],
        snapshot: SNAPSHOT,
      }),
    ).toThrow(/override target/i);
  });

  it("never yields a zero-cost executable decision when pricing exists", () => {
    for (const override of [null, { providerId: "pa", modelId: "pa:m" }, { providerId: "pb", modelId: "pb:m" }]) {
      const { decision } = resolveRoutingDecision({ request: req({ override }), rules: [], snapshot: SNAPSHOT });
      expect(Number(decision.estimatedCostUsd)).toBeGreaterThan(0);
    }
  });
});
