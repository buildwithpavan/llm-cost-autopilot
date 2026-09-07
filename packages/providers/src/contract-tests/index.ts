import { randomUUID } from "node:crypto";

import type { NormalizedRequest, PricingTable } from "@lca/core";
import { describe, expect, it } from "vitest";

import type { ProviderAdapter } from "../abstraction/provider.js";

export interface ContractSuiteOptions {
  /** Model ID to exercise. Must be in adapter.listModels(). */
  readonly modelId: string;
  /** Pricing table with an entry for (providerId, modelId). */
  readonly pricingTable: PricingTable;
  /** Optional: an API-key-style value that MUST NOT leak into any returned field. */
  readonly injectedSecret?: string;
}

/**
 * The single shared contract test suite every adapter must run.
 * See specs/001-llm-routing-mvp/contracts/provider.md for the C1..C10 rationale.
 */
export function providerContractTests(
  name: string,
  makeAdapter: () => ProviderAdapter,
  opts: ContractSuiteOptions,
): void {
  describe(`provider contract: ${name}`, () => {
    it("C1 listModels is pure and provider-scoped", () => {
      const adapter = makeAdapter();
      const first = adapter.listModels();
      const second = adapter.listModels();
      expect(first.length).toBeGreaterThan(0);
      expect(second).toEqual(first);
      for (const m of first) {
        expect(m.providerId).toBe(adapter.providerId);
        expect(m.pricingDescriptorRef).toBeTruthy();
      }
    });

    it("C2 probeHealth resolves within deadline", async () => {
      const adapter = makeAdapter();
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 2_000);
      const state = await adapter.probeHealth(controller.signal);
      clearTimeout(t);
      expect(state.providerId).toBe(adapter.providerId);
      expect(typeof state.healthy).toBe("boolean");
    });

    it("C3 execute returns success with a well-formed attempt", async () => {
      const adapter = makeAdapter();
      const controller = new AbortController();
      const result = await adapter.execute(
        {
          request: mkRequest(),
          modelId: opts.modelId,
          pricingTable: opts.pricingTable,
          deadlineAt: new Date(Date.now() + 5_000).toISOString(),
        },
        controller.signal,
      );
      expect(result.kind).toBe("success");
      if (result.kind !== "success") return;
      expect(result.attempt.errorClass).toBe("none");
      expect(result.attempt.pricingTableVersionId).toBe(opts.pricingTable.versionId);
      expect(result.attempt.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.attempt.estimatedCostUsd).toBeTruthy();
    });

    it("C8 execute honors AbortSignal", async () => {
      const adapter = makeAdapter();
      const controller = new AbortController();
      controller.abort();
      const result = await adapter.execute(
        {
          request: mkRequest(),
          modelId: opts.modelId,
          pricingTable: opts.pricingTable,
          deadlineAt: new Date(Date.now() + 5_000).toISOString(),
        },
        controller.signal,
      );
      expect(result.kind).toBe("failure");
    });

    it("C9 execute does not mutate its inputs", async () => {
      const adapter = makeAdapter();
      const request = mkRequest();
      const table = opts.pricingTable;
      const requestClone = structuredClone(request);
      const tableClone = structuredClone(table);
      await adapter.execute(
        {
          request,
          modelId: opts.modelId,
          pricingTable: table,
          deadlineAt: new Date(Date.now() + 5_000).toISOString(),
        },
        new AbortController().signal,
      );
      expect(request).toEqual(requestClone);
      expect(table).toEqual(tableClone);
    });

    it("C10 concurrent execute calls each return a valid result", async () => {
      const adapter = makeAdapter();
      const runs = Array.from({ length: 10 }, () =>
        adapter.execute(
          {
            request: mkRequest(),
            modelId: opts.modelId,
            pricingTable: opts.pricingTable,
            deadlineAt: new Date(Date.now() + 5_000).toISOString(),
          },
          new AbortController().signal,
        ),
      );
      const results = await Promise.all(runs);
      for (const r of results) {
        expect(["success", "failure"]).toContain(r.kind);
        expect(r.attempt.providerId).toBe(adapter.providerId);
      }
    });

    if (opts.injectedSecret) {
      it("C6 no configured secret appears in adapter attempt/telemetry", async () => {
        const adapter = makeAdapter();
        const result = await adapter.execute(
          {
            request: mkRequest("hello autopilot"),
            modelId: opts.modelId,
            pricingTable: opts.pricingTable,
            deadlineAt: new Date(Date.now() + 5_000).toISOString(),
          },
          new AbortController().signal,
        );
        // C6 asserts provider credentials never leak into telemetry-bound fields.
        // Response content (user echo) is intentionally excluded — redaction happens later.
        const serialized = JSON.stringify(result.attempt);
        expect(serialized).not.toContain(opts.injectedSecret);
      });
    }
  });
}

function mkRequest(content = "hello autopilot"): NormalizedRequest {
  return {
    requestId: randomUUID(),
    clientId: "contract-test",
    receivedAt: new Date().toISOString(),
    messages: [{ role: "user", content }],
    requirements: { requiredCapabilities: [] },
    override: null,
    estimatedInputTokens: 16,
  };
}
