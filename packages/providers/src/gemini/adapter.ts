import type { Model, NormalizedRequest, ErrorClass } from "@lca/core";
import { cost } from "@lca/core";

import type {
  ExecuteInput,
  ExecuteResult,
  ProviderAdapter,
} from "../abstraction/provider.js";

// Google Gemini native REST (generateContent). Uses the built-in fetch so no new
// SDK dependency is added; the caller-supplied AbortSignal drives cancellation,
// and the shared provider-attempt layer owns all timeout/retry/circuit/deadline
// behavior (this adapter adds none of its own).
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const MODELS: readonly Model[] = [
  {
    modelId: "gemini:gemini-3.5-flash-lite",
    providerId: "gemini",
    capabilities: ["json_mode", "tool_use", "function_calling"],
    contextWindow: 1_000_000,
    qualityTier: "standard",
    publishedLatencyProfile: { p50Ms: 300, p95Ms: 1_200 },
    publishedReliabilityScore: 0.98,
    pricingDescriptorRef: "gemini:gemini-3.5-flash-lite",
  },
  {
    modelId: "gemini:gemini-3.5-flash",
    providerId: "gemini",
    capabilities: ["json_mode", "tool_use", "function_calling", "vision"],
    contextWindow: 1_000_000,
    qualityTier: "high",
    publishedLatencyProfile: { p50Ms: 500, p95Ms: 1_800 },
    publishedReliabilityScore: 0.98,
    pricingDescriptorRef: "gemini:gemini-3.5-flash",
  },
];

export interface GeminiAdapterOptions {
  apiKey: string;
  /** Override the base URL (tests/self-hosted gateways). Defaults to the public API. */
  baseURL?: string;
}

interface GeminiPart {
  text?: string;
}
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export function createGeminiAdapter(opts: GeminiAdapterOptions): ProviderAdapter {
  const baseURL = (opts.baseURL ?? GEMINI_BASE_URL).replace(/\/$/, "");

  return {
    providerId: "gemini",
    listModels() {
      return MODELS;
    },
    async probeHealth(_signal: AbortSignal) {
      return {
        providerId: "gemini",
        healthy: true,
        lastProbedAt: new Date().toISOString(),
        consecutiveFailures: 0,
      };
    },
    async execute(input: ExecuteInput, signal: AbortSignal): Promise<ExecuteResult> {
      const startedAt = new Date().toISOString();
      const geminiModelId = input.modelId.split(":")[1] ?? input.modelId;
      try {
        const res = await fetch(`${baseURL}/models/${geminiModelId}:generateContent`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": opts.apiKey,
          },
          body: JSON.stringify(toGeminiRequest(input.request)),
          signal,
        });
        if (!res.ok) {
          return failure(input, startedAt, classifyGeminiStatus(res.status));
        }
        const data = (await res.json()) as GeminiResponse;
        const endedAt = new Date().toISOString();
        const candidate = data.candidates?.[0];
        const content = (candidate?.content?.parts ?? [])
          .map((p) => p.text ?? "")
          .join("");
        const inputTokens =
          data.usageMetadata?.promptTokenCount ?? input.request.estimatedInputTokens;
        const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
        const estimatedCostUsd = cost.estimateCostUsd({
          table: input.pricingTable,
          providerId: "gemini",
          modelId: input.modelId,
          inputTokens,
          outputTokens,
        });
        return {
          kind: "success",
          content,
          finishReason: candidate?.finishReason ?? "STOP",
          attempt: {
            attemptIndex: 0,
            providerId: "gemini",
            modelId: input.modelId,
            startedAt,
            endedAt,
            latencyMs: elapsedMs(startedAt, endedAt),
            inputTokens,
            outputTokens,
            errorClass: "none",
            estimatedCostUsd,
            actualCostUsd: estimatedCostUsd,
            pricingTableVersionId: input.pricingTable.versionId,
          },
        };
      } catch (err) {
        return failure(input, startedAt, classifyGeminiThrow(err));
      }
    },
  };
}

function toGeminiRequest(req: NormalizedRequest): Record<string, unknown> {
  const contents: Array<{ role: "user" | "model"; parts: GeminiPart[] }> = [];
  const systemText: string[] = [];
  for (const m of req.messages) {
    if (m.role === "system") {
      systemText.push(m.content);
      continue;
    }
    contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] });
  }
  const body: Record<string, unknown> = { contents };
  if (systemText.length > 0) {
    body["systemInstruction"] = { parts: [{ text: systemText.join("\n") }] };
  }
  return body;
}

function failure(input: ExecuteInput, startedAt: string, errorClass: ErrorClass): ExecuteResult {
  return {
    kind: "failure",
    attempt: {
      attemptIndex: 0,
      providerId: "gemini",
      modelId: input.modelId,
      startedAt,
      endedAt: new Date().toISOString(),
      latencyMs: elapsedMs(startedAt, new Date().toISOString()),
      inputTokens: null,
      outputTokens: null,
      errorClass,
      estimatedCostUsd: "0",
      actualCostUsd: null,
      pricingTableVersionId: input.pricingTable.versionId,
    },
  };
}

function elapsedMs(start: string, end: string): number {
  return Math.max(0, new Date(end).getTime() - new Date(start).getTime());
}

function classifyGeminiStatus(status: number): ErrorClass {
  if (status === 429) return "rate_limit";
  if (status >= 500) return "upstream_5xx";
  if (status >= 400) return "upstream_4xx";
  return "provider_unavailable";
}

function classifyGeminiThrow(err: unknown): ErrorClass {
  const anyErr = err as { name?: string };
  if (anyErr?.name === "AbortError") return "timeout";
  return "provider_unavailable";
}
