import type { PricingTable } from "@lca/core";
import { vi } from "vitest";

import { providerContractTests } from "../src/contract-tests/index.js";
import { createAnthropicAdapter } from "../src/anthropic/adapter.js";

const PRICING: PricingTable = {
  versionId: "test-anthropic",
  effectiveFrom: "2026-09-08T00:00:00.000Z",
  entries: [
    {
      providerId: "anthropic",
      modelId: "anthropic:claude-3-5-haiku",
      unitInputUsdPerToken: "0.0000008",
      unitOutputUsdPerToken: "0.000004",
      currency: "USD",
    },
  ],
};

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    apiKey: string;
    messages = {
      create: async (_params: unknown, _opts: { signal?: AbortSignal } = {}) => {
        if (_opts.signal?.aborted) {
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        }
        return {
          content: [{ type: "text", text: "mocked anthropic reply" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    };
    constructor(opts: { apiKey: string }) {
      this.apiKey = opts.apiKey;
    }
  }
  return { default: Anthropic };
});

providerContractTests(
  "anthropic (mocked SDK)",
  () => createAnthropicAdapter({ apiKey: "sk-ant-test-not-a-real-key" }),
  {
    modelId: "anthropic:claude-3-5-haiku",
    pricingTable: PRICING,
    injectedSecret: "sk-ant-test-not-a-real-key",
  },
);
