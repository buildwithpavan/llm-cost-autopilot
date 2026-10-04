import { randomUUID } from "node:crypto";

import type { NormalizedRequest, PricingTable } from "@lca/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { providerContractTests } from "../src/contract-tests/index.js";
import { createGeminiAdapter } from "../src/gemini/adapter.js";

const PRICING: PricingTable = {
  versionId: "test-gemini",
  effectiveFrom: "2026-09-08T00:00:00.000Z",
  entries: [
    {
      providerId: "gemini",
      modelId: "gemini:gemini-3.5-flash-lite",
      unitInputUsdPerToken: "0.0000003",
      unitOutputUsdPerToken: "0.0000025",
      currency: "USD",
    },
  ],
};

const SECRET = "gm-test-not-a-real-key";

function geminiBody(text: string, prompt?: number, candidates?: number): unknown {
  const body: Record<string, unknown> = {
    candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
  };
  if (prompt !== undefined || candidates !== undefined) {
    body["usageMetadata"] = { promptTokenCount: prompt, candidatesTokenCount: candidates };
  }
  return body;
}

function jsonResponse(body: unknown, status = 200) {
  return new globalThis.Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Default mock: a successful Gemini response that honors abort. Reinstalled
// before every test so the shared contract suite always sees a healthy provider.
function installDefaultFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    if ((init as RequestInit | undefined)?.signal?.aborted) {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
    return jsonResponse(geminiBody("mocked gemini reply", 12, 7));
  });
}

let fetchSpy: ReturnType<typeof installDefaultFetch>;
beforeEach(() => {
  fetchSpy = installDefaultFetch();
});
afterEach(() => {
  vi.restoreAllMocks();
});

providerContractTests("gemini (mocked fetch)", () => createGeminiAdapter({ apiKey: SECRET }), {
  modelId: "gemini:gemini-3.5-flash-lite",
  pricingTable: PRICING,
  injectedSecret: SECRET,
});

function mkRequest(content = "hi"): NormalizedRequest {
  return {
    requestId: randomUUID(),
    clientId: "gemini-test",
    receivedAt: new Date().toISOString(),
    messages: [{ role: "user", content }],
    requirements: { requiredCapabilities: [] },
    override: null,
    estimatedInputTokens: 16,
  };
}

async function run(signal = new AbortController().signal) {
  return createGeminiAdapter({ apiKey: SECRET }).execute(
    {
      request: mkRequest(),
      modelId: "gemini:gemini-3.5-flash-lite",
      pricingTable: PRICING,
      deadlineAt: new Date(Date.now() + 5_000).toISOString(),
    },
    signal,
  );
}

describe("gemini adapter specifics", () => {
  it("normalizes a successful response and extracts usageMetadata tokens", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(geminiBody("hello world", 200_000, 100_000)));
    const r = await run();
    expect(r.kind).toBe("success");
    if (r.kind !== "success") return;
    expect(r.content).toBe("hello world");
    expect(r.attempt.inputTokens).toBe(200_000);
    expect(r.attempt.outputTokens).toBe(100_000);
    // 200000*0.0000003 + 100000*0.0000025 = 0.06 + 0.25 = 0.31 (exact, 6-dp)
    expect(r.attempt.estimatedCostUsd).toBe("0.31");
    expect(r.attempt.actualCostUsd).toBe("0.31");
  });

  it("sends the API key as a header, never in the URL or the attempt", async () => {
    await run();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).not.toContain(SECRET);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe(SECRET);
  });

  it("falls back to estimated input tokens when usageMetadata is missing", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(geminiBody("no usage")));
    const r = await run();
    expect(r.kind).toBe("success");
    if (r.kind !== "success") return;
    expect(r.attempt.inputTokens).toBe(16);
    expect(r.attempt.outputTokens).toBe(0);
  });

  it("handles a malformed response (no candidates) as empty content, not a crash", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ unexpected: true }));
    const r = await run();
    expect(r.kind).toBe("success");
    if (r.kind !== "success") return;
    expect(r.content).toBe("");
    expect(r.attempt.outputTokens).toBe(0);
  });

  it("maps HTTP 429 to rate_limit", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429));
    expect((await run()).attempt.errorClass).toBe("rate_limit");
  });

  it("maps HTTP 5xx to upstream_5xx", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "boom" }, 503));
    expect((await run()).attempt.errorClass).toBe("upstream_5xx");
  });

  it("maps an authentication 401/403 to upstream_4xx", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401));
    expect((await run()).attempt.errorClass).toBe("upstream_4xx");
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "forbidden" }, 403));
    expect((await run()).attempt.errorClass).toBe("upstream_4xx");
  });

  it("maps a network/transport failure to provider_unavailable", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await run()).attempt.errorClass).toBe("provider_unavailable");
  });

  it("maps an aborted signal to a timeout failure", async () => {
    const c = new AbortController();
    c.abort();
    const r = await run(c.signal);
    expect(r.kind).toBe("failure");
    expect(r.attempt.errorClass).toBe("timeout");
  });

  it("maps system/assistant roles to Gemini's systemInstruction/model roles", async () => {
    const adapter = createGeminiAdapter({ apiKey: SECRET });
    await adapter.execute(
      {
        request: {
          ...mkRequest("user turn"),
          messages: [
            { role: "system", content: "be terse" },
            { role: "user", content: "hi" },
            { role: "assistant", content: "hello" },
          ],
        },
        modelId: "gemini:gemini-3.5-flash-lite",
        pricingTable: PRICING,
        deadlineAt: new Date(Date.now() + 5_000).toISOString(),
      },
      new AbortController().signal,
    );
    const body = JSON.parse((fetchSpy.mock.calls.at(-1)![1] as RequestInit).body as string);
    expect(body.systemInstruction.parts[0].text).toBe("be terse");
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model"]);
  });
});
