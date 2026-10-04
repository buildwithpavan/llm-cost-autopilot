import { randomUUID } from "node:crypto";

import type { NormalizedRequest, PricingTable } from "@lca/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { providerContractTests } from "../src/contract-tests/index.js";
import { createGroqAdapter } from "../src/groq/adapter.js";

const PRICING: PricingTable = {
  versionId: "test-groq",
  effectiveFrom: "2026-09-08T00:00:00.000Z",
  entries: [
    {
      providerId: "groq",
      modelId: "groq:openai/gpt-oss-20b",
      unitInputUsdPerToken: "0.000000075",
      unitOutputUsdPerToken: "0.0000003",
      currency: "USD",
    },
  ],
};

// Mutable mock behavior so individual tests can drive success vs. specific failures.
const mock: {
  mode: "success" | "throw";
  error: unknown;
  usage: { prompt_tokens: number; completion_tokens: number } | undefined;
} = { mode: "success", error: null, usage: { prompt_tokens: 10, completion_tokens: 5 } };

// Stub the openai SDK (Groq reuses it with a base URL) — no network involved.
vi.mock("openai", () => {
  class OpenAI {
    apiKey: string;
    baseURL: string | undefined;
    chat = {
      completions: {
        create: async (_params: unknown, opts: { signal?: AbortSignal } = {}) => {
          if (opts.signal?.aborted) {
            const err = new Error("aborted");
            err.name = "AbortError";
            throw err;
          }
          if (mock.mode === "throw") throw mock.error;
          return {
            choices: [{ message: { content: "mocked groq reply" }, finish_reason: "stop" }],
            usage: mock.usage,
          };
        },
      },
    };
    constructor(opts: { apiKey: string; baseURL?: string }) {
      this.apiKey = opts.apiKey;
      this.baseURL = opts.baseURL;
    }
  }
  return { default: OpenAI };
});

providerContractTests(
  "groq (mocked SDK)",
  () => createGroqAdapter({ apiKey: "gsk-test-not-a-real-key" }),
  {
    modelId: "groq:openai/gpt-oss-20b",
    pricingTable: PRICING,
    injectedSecret: "gsk-test-not-a-real-key",
  },
);

function mkRequest(content = "hi"): NormalizedRequest {
  return {
    requestId: randomUUID(),
    clientId: "groq-test",
    receivedAt: new Date().toISOString(),
    messages: [{ role: "user", content }],
    requirements: { requiredCapabilities: [] },
    override: null,
    estimatedInputTokens: 16,
  };
}

async function run(signal = new AbortController().signal) {
  return createGroqAdapter({ apiKey: "gsk-test-not-a-real-key" }).execute(
    {
      request: mkRequest(),
      modelId: "groq:openai/gpt-oss-20b",
      pricingTable: PRICING,
      deadlineAt: new Date(Date.now() + 5_000).toISOString(),
    },
    signal,
  );
}

describe("groq adapter specifics", () => {
  beforeEach(() => {
    mock.mode = "success";
    mock.error = null;
    mock.usage = { prompt_tokens: 10, completion_tokens: 5 };
  });

  it("normalizes a successful completion and extracts provider token usage", async () => {
    mock.usage = { prompt_tokens: 200_000, completion_tokens: 100_000 };
    const r = await run();
    expect(r.kind).toBe("success");
    if (r.kind !== "success") return;
    expect(r.content).toBe("mocked groq reply");
    expect(r.attempt.inputTokens).toBe(200_000);
    expect(r.attempt.outputTokens).toBe(100_000);
    expect(r.attempt.providerId).toBe("groq");
    // 200000*0.000000075 + 100000*0.0000003 = 0.015 + 0.03 = 0.045 (exact, 6-dp)
    expect(r.attempt.estimatedCostUsd).toBe("0.045");
    expect(r.attempt.actualCostUsd).toBe("0.045");
  });

  it("falls back to estimated input tokens when usage is absent", async () => {
    mock.usage = undefined;
    const r = await run();
    expect(r.kind).toBe("success");
    if (r.kind !== "success") return;
    expect(r.attempt.inputTokens).toBe(16);
    expect(r.attempt.outputTokens).toBe(0);
  });

  it("maps a 429 to rate_limit", async () => {
    mock.mode = "throw";
    mock.error = { status: 429 };
    const r = await run();
    expect(r.attempt.errorClass).toBe("rate_limit");
  });

  it("maps a 5xx to upstream_5xx", async () => {
    mock.mode = "throw";
    mock.error = { status: 503 };
    expect((await run()).attempt.errorClass).toBe("upstream_5xx");
  });

  it("maps an auth 401 to upstream_4xx (matches existing providers)", async () => {
    mock.mode = "throw";
    mock.error = { status: 401 };
    expect((await run()).attempt.errorClass).toBe("upstream_4xx");
  });

  it("maps an unexpected non-HTTP throw to provider_unavailable", async () => {
    mock.mode = "throw";
    mock.error = new Error("socket hang up");
    expect((await run()).attempt.errorClass).toBe("provider_unavailable");
  });

  it("maps an aborted signal to a timeout failure", async () => {
    const c = new AbortController();
    c.abort();
    const r = await run(c.signal);
    expect(r.kind).toBe("failure");
    expect(r.attempt.errorClass).toBe("timeout");
  });

  it("never leaks the API key into the attempt", async () => {
    const r = await run();
    expect(JSON.stringify(r.attempt)).not.toContain("gsk-test-not-a-real-key");
  });
});
