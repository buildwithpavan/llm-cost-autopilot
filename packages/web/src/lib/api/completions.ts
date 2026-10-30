import type { Capability, RoutingDecision } from "../../types/index.js";
import { apiRequest } from "./client.js";

export interface CompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequirements {
  requiredCapabilities?: Capability[];
  minQualityTier?: "low" | "standard" | "high";
  maxLatencyMs?: number;
  /** Decimal USD string — preserved as-is (never floated). */
  maxCostUsd?: string;
}

export interface CompletionOverride {
  providerId?: string;
  modelId?: string;
}

/** Mirrors the backend completionRequestSchema accepted by POST /v1/completions. */
export interface CompletionRequestBody {
  messages: CompletionMessage[];
  requirements?: CompletionRequirements;
  override?: CompletionOverride;
}

/** Mirrors the backend CompletionResponseBody (NormalizedResponse + routing decision). */
export interface CompletionResponse {
  requestId: string;
  providerId: string;
  modelId: string;
  content: string;
  usage: { inputTokens: number; outputTokens: number };
  finishReason: string;
  decision: RoutingDecision;
}

/**
 * POST /v1/completions — executes the request against the chosen provider and
 * writes telemetry. Returns the generated content plus the full RoutingDecision
 * (chosen target, candidate ranking with per-candidate estimated cost, rationale).
 */
export function postCompletion(
  request: CompletionRequestBody,
  opts: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<CompletionResponse> {
  const reqOpts: {
    method: "POST";
    body: CompletionRequestBody;
    apiKey?: string;
    signal?: AbortSignal;
  } = {
    method: "POST",
    body: request,
  };
  if (opts.apiKey) reqOpts.apiKey = opts.apiKey;
  if (opts.signal) reqOpts.signal = opts.signal;
  return apiRequest<CompletionResponse>("/v1/completions", reqOpts);
}
