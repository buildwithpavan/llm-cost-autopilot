import Anthropic from "@anthropic-ai/sdk";

import type { Model, ErrorClass } from "@lca/core";
import { cost } from "@lca/core";

import type {
  ExecuteInput,
  ExecuteResult,
  ProviderAdapter,
} from "../abstraction/provider.js";

const MODELS: readonly Model[] = [
  {
    modelId: "anthropic:claude-3-5-haiku",
    providerId: "anthropic",
    capabilities: ["json_mode", "tool_use"],
    contextWindow: 200_000,
    qualityTier: "standard",
    publishedLatencyProfile: { p50Ms: 350, p95Ms: 1_200 },
    publishedReliabilityScore: 0.98,
    pricingDescriptorRef: "anthropic:claude-3-5-haiku",
  },
  {
    modelId: "anthropic:claude-3-5-sonnet",
    providerId: "anthropic",
    capabilities: ["json_mode", "tool_use", "vision"],
    contextWindow: 200_000,
    qualityTier: "high",
    publishedLatencyProfile: { p50Ms: 800, p95Ms: 2_400 },
    publishedReliabilityScore: 0.99,
    pricingDescriptorRef: "anthropic:claude-3-5-sonnet",
  },
];

export interface AnthropicAdapterOptions {
  apiKey: string;
}

export function createAnthropicAdapter(opts: AnthropicAdapterOptions): ProviderAdapter {
  const client = new Anthropic({ apiKey: opts.apiKey });

  return {
    providerId: "anthropic",
    listModels() {
      return MODELS;
    },
    async probeHealth(_signal: AbortSignal) {
      return {
        providerId: "anthropic",
        healthy: true,
        lastProbedAt: new Date().toISOString(),
        consecutiveFailures: 0,
      };
    },
    async execute(input: ExecuteInput, signal: AbortSignal): Promise<ExecuteResult> {
      const startedAt = new Date().toISOString();
      const anthropicModelId = input.modelId.split(":")[1] ?? input.modelId;
      const systemMsg = input.request.messages.find((m) => m.role === "system");
      const nonSystem = input.request.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
      try {
        const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
          model: anthropicModelId,
          max_tokens: 1024,
          messages: nonSystem,
        };
        if (systemMsg) {
          params.system = systemMsg.content;
        }
        const message = await client.messages.create(params, { signal });
        const endedAt = new Date().toISOString();
        const inputTokens = message.usage?.input_tokens ?? input.request.estimatedInputTokens;
        const outputTokens = message.usage?.output_tokens ?? 0;
        const estimatedCostUsd = cost.estimateCostUsd({
          table: input.pricingTable,
          providerId: "anthropic",
          modelId: input.modelId,
          inputTokens,
          outputTokens,
        });
        const firstBlock = message.content[0];
        const content = firstBlock?.type === "text" ? firstBlock.text : "";
        return {
          kind: "success",
          content,
          finishReason: message.stop_reason ?? "end_turn",
          attempt: {
            attemptIndex: 0,
            providerId: "anthropic",
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
            providerId: "anthropic",
            modelId: input.modelId,
            startedAt,
            endedAt: new Date().toISOString(),
            latencyMs: elapsedMs(startedAt, new Date().toISOString()),
            inputTokens: null,
            outputTokens: null,
            errorClass: classifyAnthropicError(err),
            estimatedCostUsd: "0",
            actualCostUsd: null,
            pricingTableVersionId: input.pricingTable.versionId,
          },
        };
      }
    },
  };
}

function elapsedMs(start: string, end: string): number {
  return Math.max(0, new Date(end).getTime() - new Date(start).getTime());
}

function classifyAnthropicError(err: unknown): ErrorClass {
  const anyErr = err as { name?: string; status?: number };
  if (anyErr?.name === "AbortError") return "timeout";
  const status = anyErr?.status;
  if (status === 429) return "rate_limit";
  if (typeof status === "number" && status >= 500) return "upstream_5xx";
  if (typeof status === "number" && status >= 400) return "upstream_4xx";
  return "provider_unavailable";
}
