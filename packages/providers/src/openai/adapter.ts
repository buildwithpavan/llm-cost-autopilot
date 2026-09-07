import OpenAI from "openai";

import type { Model, NormalizedRequest, ErrorClass } from "@lca/core";
import { cost } from "@lca/core";

import type {
  ExecuteInput,
  ExecuteResult,
  ProviderAdapter,
} from "../abstraction/provider.js";

const MODELS: readonly Model[] = [
  {
    modelId: "openai:gpt-4o-mini",
    providerId: "openai",
    capabilities: ["json_mode", "tool_use", "function_calling"],
    contextWindow: 128_000,
    qualityTier: "standard",
    publishedLatencyProfile: { p50Ms: 400, p95Ms: 1_500 },
    publishedReliabilityScore: 0.98,
    pricingDescriptorRef: "openai:gpt-4o-mini",
  },
  {
    modelId: "openai:gpt-4o",
    providerId: "openai",
    capabilities: ["json_mode", "tool_use", "function_calling", "vision"],
    contextWindow: 128_000,
    qualityTier: "high",
    publishedLatencyProfile: { p50Ms: 900, p95Ms: 3_000 },
    publishedReliabilityScore: 0.99,
    pricingDescriptorRef: "openai:gpt-4o",
  },
];

export interface OpenAiAdapterOptions {
  apiKey: string;
}

export function createOpenAiAdapter(opts: OpenAiAdapterOptions): ProviderAdapter {
  const client = new OpenAI({ apiKey: opts.apiKey });

  return {
    providerId: "openai",
    listModels() {
      return MODELS;
    },
    async probeHealth(_signal: AbortSignal) {
      return {
        providerId: "openai",
        healthy: true,
        lastProbedAt: new Date().toISOString(),
        consecutiveFailures: 0,
      };
    },
    async execute(input: ExecuteInput, signal: AbortSignal): Promise<ExecuteResult> {
      const startedAt = new Date().toISOString();
      const openaiModelId = input.modelId.split(":")[1] ?? input.modelId;
      try {
        const response = await client.chat.completions.create(
          {
            model: openaiModelId,
            messages: mapMessages(input.request),
          },
          { signal },
        );
        const endedAt = new Date().toISOString();
        const inputTokens = response.usage?.prompt_tokens ?? input.request.estimatedInputTokens;
        const outputTokens = response.usage?.completion_tokens ?? 0;
        const estimatedCostUsd = cost.estimateCostUsd({
          table: input.pricingTable,
          providerId: "openai",
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
            providerId: "openai",
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
            providerId: "openai",
            modelId: input.modelId,
            startedAt,
            endedAt: new Date().toISOString(),
            latencyMs: elapsedMs(startedAt, new Date().toISOString()),
            inputTokens: null,
            outputTokens: null,
            errorClass: classifyOpenAiError(err),
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

function classifyOpenAiError(err: unknown): ErrorClass {
  const anyErr = err as { name?: string; status?: number; code?: string };
  if (anyErr?.name === "AbortError") return "timeout";
  const status = anyErr?.status;
  if (status === 429) return "rate_limit";
  if (typeof status === "number" && status >= 500) return "upstream_5xx";
  if (typeof status === "number" && status >= 400) return "upstream_4xx";
  return "provider_unavailable";
}
