import { describe, expect, it } from "vitest";
import { createMockAdapter, armMockFailure } from "@lca/providers";
import type { PricingTable } from "@lca/core";

/**
 * Milestone 2.5 helper: confirm the dev-only armMockFailure() plumbing
 * causes the very next execute() to return the requested failure, and does
 * not affect subsequent calls.
 */
describe("armMockFailure", () => {
  const pricingTable: PricingTable = {
    versionId: "pt-v",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    entries: [
      {
        providerId: "mock-cheap",
        modelId: "mock-cheap:small",
        unitInputUsdPerToken: "0.000001",
        unitOutputUsdPerToken: "0.000001",
        currency: "USD",
      },
    ],
  };

  const input = {
    request: {
      requestId: "r1",
      clientId: "acme",
      receivedAt: "2026-09-09T10:00:00Z",
      messages: [{ role: "user" as const, content: "hi" }],
      requirements: {
        requiredCapabilities: [],
        maxLatencyMs: null,
        maxCostUsd: null,
        minQualityTier: null,
      },
      override: null,
      estimatedInputTokens: 4,
    },
    modelId: "mock-cheap:small",
    pricingTable,
    deadlineAt: new Date(Date.now() + 30_000).toISOString(),
  };

  it("arms exactly one failure then returns to normal", async () => {
    const adapter = createMockAdapter({ providerId: "mock-cheap" });
    expect(armMockFailure(adapter, "upstream_5xx")).toBe(true);
    const failed = await adapter.execute(input, new AbortController().signal);
    expect(failed.kind).toBe("failure");
    if (failed.kind === "failure") {
      expect(failed.attempt.errorClass).toBe("upstream_5xx");
    }
    // second call succeeds
    const ok = await adapter.execute(input, new AbortController().signal);
    expect(ok.kind).toBe("success");
  });

  it("armMockFailure on a non-mock adapter returns false", () => {
    // Use a stub with no __mockArmFailure property.
    const bareAdapter = {
      providerId: "bare",
      listModels: () => [],
      probeHealth: async () => ({
        providerId: "bare",
        healthy: true,
        lastProbedAt: new Date().toISOString(),
        consecutiveFailures: 0,
      }),
      execute: async () => ({ kind: "failure" as const, attempt: {} as never }),
    };
    expect(armMockFailure(bareAdapter, "upstream_5xx")).toBe(false);
  });
});
