import OpenAI from "openai";

import type { Model, NormalizedRequest, ErrorClass } from "@lca/core";
import { cost } from "@lca/core";

import type {
  ExecuteInput,
  ExecuteResult,
  ProviderAdapter,
} from "../abstraction/provider.js";

// Groq exposes an OpenAI-compatible Chat Completions API, so this adapter reuses
// the existing `openai` SDK pointed at Groq's base URL. Provider identity, model
// configuration, token accounting, error normalization, and health stay distinct.
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

const MODELS: readonly Model[] = [
  {
    modelId: "groq:openai/gpt-oss-20b",
    providerId: "groq",
    capabilities: ["json_mode", "tool_use", "function_calling"],
    contextWindow: 131_072,
    qualityTier: "standard",
    publishedLatencyProfile: { p50Ms: 120, p95Ms: 500 },
    publishedReliabilityScore: 0.97,
    pricingDescriptorRef: "groq:openai/gpt-oss-20b",
  },
  {
    modelId: "groq:openai/gpt-oss-120b",
    providerId: "groq",
    capabilities: ["json_mode", "tool_use", "function_calling"],
    contextWindow: 131_072,
    qualityTier: "high",
    publishedLatencyProfile: { p50Ms: 250, p95Ms: 900 },
    publishedReliabilityScore: 0.98,
    pricingDescriptorRef: "groq:openai/gpt-oss-120b",
  },
];

export interface GroqAdapterOptions {
  apiKey: string;
  /** Override the Groq base URL (tests/self-hosted gateways). Defaults to the public API. */
  baseURL?: string;
}

export function createGroqAdapter(opts: GroqAdapterOptions): ProviderAdapter {
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL ?? GROQ_BASE_URL });

  return {
    providerId: "groq",
    listModels() {
      return MODELS;
    },
    async probeHealth(_signal: AbortSignal) {
      return {
        providerId: "groq",
        healthy: true,
        lastProbedAt: new Date().toISOString(),
        consecutiveFailures: 0,
      };
    },
    async execute(input: ExecuteInput, signal: AbortSignal): Promise<ExecuteResult> {
      const startedAt = new Date().toISOString();
      const groqModelId = input.modelId.split(":")[1] ?? input.modelId;
      try {
        const response = await client.chat.completions.create(
          {
            model: groqModelId,
            messages: mapMessages(input.request),
          },
          { signal },
        );
        const endedAt = new Date().toISOString();
        const inputTokens = response.usage?.prompt_tokens ?? input.request.estimatedInputTokens;
        const outputTokens = response.usage?.completion_tokens ?? 0;
        const estimatedCostUsd = cost.estimateCostUsd({
          table: input.pricingTable,
          providerId: "groq",
          modelId: input.modelId,
          inputTokens,
          outputTokens,
        });
        const content = response.choices[0]?.message?.content ?? "";
        return {
          kind: "success",
          content,
          finishReason: response.choices[0]?.finish_reason ?? "stop",
          attempt: {
            attemptIndex: 0,
            providerId: "groq",
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
        return {
          kind: "failure",
          attempt: {
            attemptIndex: 0,
            providerId: "groq",
            modelId: input.modelId,
            startedAt,
            endedAt: new Date().toISOString(),
            latencyMs: elapsedMs(startedAt, new Date().toISOString()),
            inputTokens: null,
            outputTokens: null,
            errorClass: classifyGroqError(err),
            estimatedCostUsd: "0",
            actualCostUsd: null,
            pricingTableVersionId: input.pricingTable.versionId,
          },
        };
      }
    },
  };
}

function mapMessages(req: NormalizedRequest): OpenAI.Chat.ChatCompletionMessageParam[] {
  return req.messages.map((m) => ({ role: m.role, content: m.content })) as
    OpenAI.Chat.ChatCompletionMessageParam[];
}

function elapsedMs(start: string, end: string): number {
  return Math.max(0, new Date(end).getTime() - new Date(start).getTime());
}

function classifyGroqError(err: unknown): ErrorClass {
  const anyErr = err as { name?: string; status?: number };
  if (anyErr?.name === "AbortError") return "timeout";
  const status = anyErr?.status;
  if (status === 429) return "rate_limit";
  if (typeof status === "number" && status >= 500) return "upstream_5xx";
  if (typeof status === "number" && status >= 400) return "upstream_4xx";
  return "provider_unavailable";
}
