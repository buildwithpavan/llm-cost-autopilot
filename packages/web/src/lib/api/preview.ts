import type { Capability, RoutingDecision } from "../../types/index.js";
import { apiRequest } from "./client.js";

export interface PreviewMessage {
  role: "user";
  content: string;
}

export interface PreviewRequirements {
  requiredCapabilities?: Capability[];
  minQualityTier?: "low" | "standard" | "high";
  maxLatencyMs?: number;
  /** Decimal USD string — preserved as-is (never floated). */
  maxCostUsd?: string;
}

export interface PreviewOverride {
  providerId?: string;
  modelId?: string;
}

/** Mirrors the backend completionRequestSchema accepted by POST /v1/routing/preview. */
export interface RoutingPreviewRequest {
  messages: PreviewMessage[];
  requirements?: PreviewRequirements;
  override?: PreviewOverride;
}

/**
 * POST /v1/routing/preview — server-side routing dry-run.
 * Does not invoke providers and does not write telemetry; returns a RoutingDecision.
 */
export function postRoutingPreview(
  request: RoutingPreviewRequest,
  opts: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<RoutingDecision> {
  const reqOpts: { method: "POST"; body: RoutingPreviewRequest; apiKey?: string; signal?: AbortSignal } = {
    method: "POST",
    body: request,
  };
  if (opts.apiKey) reqOpts.apiKey = opts.apiKey;
  if (opts.signal) reqOpts.signal = opts.signal;
  return apiRequest<RoutingDecision>("/v1/routing/preview", reqOpts);
}
