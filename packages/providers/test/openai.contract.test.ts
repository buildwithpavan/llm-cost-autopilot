import type { PricingTable } from "@lca/core";
import { vi } from "vitest";

import { providerContractTests } from "../src/contract-tests/index.js";
import { createOpenAiAdapter } from "../src/openai/adapter.js";

const PRICING: PricingTable = {
  versionId: "test-openai",
  effectiveFrom: "2026-09-08T00:00:00.000Z",
  entries: [
    {
      providerId: "openai",
      modelId: "openai:gpt-4o-mini",
      unitInputUsdPerToken: "0.00000015",
      unitOutputUsdPerToken: "0.0000006",
      currency: "USD",
    },
  ],
};

// Stub the openai SDK's default class so no network is involved.
vi.mock("openai", () => {
  class OpenAI {
    apiKey: string;
    chat = {
      completions: {
        create: async (
          _params: unknown,
          _opts: { signal?: AbortSignal } = {},
        ) => {
          if (_opts.signal?.aborted) {
            const err = new Error("aborted");
            err.name = "AbortError";
            throw err;
          }
          return {
            choices: [
              { message: { content: "mocked openai reply" }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          };
        },
      },
    };
    constructor(opts: { apiKey: string }) {
      this.apiKey = opts.apiKey;
    }
  }
  return { default: OpenAI };
});

providerContractTests(
  "openai (mocked SDK)",
  () => createOpenAiAdapter({ apiKey: "sk-test-not-a-real-key" }),
  {
    modelId: "openai:gpt-4o-mini",
    pricingTable: PRICING,
    injectedSecret: "sk-test-not-a-real-key",
  },
);
