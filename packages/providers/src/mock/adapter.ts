import { cost, type ErrorClass, type Model, type NormalizedRequest } from "@lca/core";

import type { ExecuteInput, ExecuteResult, ProviderAdapter } from "../abstraction/provider.js";

const DEFAULT_MODELS_CHEAP: readonly Model[] = [
  {
    modelId: "mock-cheap:small",
    providerId: "mock-cheap",
    capabilities: ["json_mode"],
    contextWindow: 8_000,
    qualityTier: "standard",
    publishedLatencyProfile: { p50Ms: 150, p95Ms: 400 },
    publishedReliabilityScore: 0.99,
    pricingDescriptorRef: "mock-cheap:small",
  },
  {
    modelId: "mock-cheap:large",
    providerId: "mock-cheap",
    capabilities: ["json_mode", "tool_use", "function_calling"],
    contextWindow: 32_000,
    qualityTier: "high",
    publishedLatencyProfile: { p50Ms: 400, p95Ms: 900 },
    publishedReliabilityScore: 0.995,
    pricingDescriptorRef: "mock-cheap:large",
  },
];

const DEFAULT_MODELS_FAST: readonly Model[] = [
  {
    modelId: "mock-fast:default",
    providerId: "mock-fast",
    capabilities: ["json_mode", "function_calling"],
    contextWindow: 16_000,
    qualityTier: "standard",
    publishedLatencyProfile: { p50Ms: 40, p95Ms: 120 },
    publishedReliabilityScore: 0.98,
    pricingDescriptorRef: "mock-fast:default",
  },
];

export interface MockAdapterOptions {
  readonly providerId: string;
  readonly models?: readonly Model[];
  /** When set, the first execute() call returns a failure of this error class. */
  readonly failFirstWith?: ErrorClass;
  /** Force `healthy: false` on next probe (for test injection). */
  readonly forceUnhealthy?: boolean;
}

/**
 * Deterministic mock adapter for tests and local dev.
 * Response content is derived from request messages so acceptance tests can assert on it.
 */
export function createMockAdapter(opts: MockAdapterOptions): ProviderAdapter {
  const models =
    opts.models ??
    (opts.providerId === "mock-fast" ? DEFAULT_MODELS_FAST : DEFAULT_MODELS_CHEAP);
  let failsRemaining = opts.failFirstWith ? 1 : 0;
  const state = { forceUnhealthy: opts.forceUnhealthy ?? false };

  return {
    providerId: opts.providerId,
    listModels() {
      return models;
    },
    async probeHealth(_signal: AbortSignal) {
      return {
        providerId: opts.providerId,
        healthy: !state.forceUnhealthy,
        lastProbedAt: new Date().toISOString(),
        consecutiveFailures: state.forceUnhealthy ? 3 : 0,
      };
    },
    async execute(input: ExecuteInput, signal: AbortSignal): Promise<ExecuteResult> {
      const startedAt = new Date().toISOString();
      // Respect abort signal
      if (signal.aborted) {
        return failure(input, opts.providerId, startedAt, "timeout");
      }
      if (failsRemaining > 0 && opts.failFirstWith && opts.failFirstWith !== "none") {
        failsRemaining--;
        return failure(input, opts.providerId, startedAt, opts.failFirstWith);
      }

      const inputTokens = input.request.estimatedInputTokens;
      const outputTokens = deriveOutputTokens(input.request);
      const estimatedCostUsd = cost.estimateCostUsd({
        table: input.pricingTable,
        providerId: opts.providerId,
        modelId: input.modelId,
        inputTokens,
        outputTokens,
      });
      const actualCostUsd = estimatedCostUsd;
      const endedAt = new Date().toISOString();

      return {
        kind: "success",
        content: buildMockResponse(input.request, opts.providerId, input.modelId),
        finishReason: "stop",
        attempt: {
          attemptIndex: 0,
          providerId: opts.providerId,
          modelId: input.modelId,
          startedAt,
          endedAt,
          latencyMs: Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime()),
          inputTokens,
          outputTokens,
          errorClass: "none",
          estimatedCostUsd,
          actualCostUsd,
          pricingTableVersionId: input.pricingTable.versionId,
        },
      };
    },
  };
}

function deriveOutputTokens(req: NormalizedRequest): number {
  // Deterministic: 1/4 of input tokens, min 4, max 128. Keeps tests reproducible.
  return Math.min(128, Math.max(4, Math.floor(req.estimatedInputTokens / 4)));
}

function buildMockResponse(req: NormalizedRequest, providerId: string, modelId: string): string {
  const last = req.messages[req.messages.length - 1];
  const echo = last?.content?.slice(0, 80) ?? "";
  return `[mock:${providerId}/${modelId}] ${echo}`;
}

function failure(
  input: ExecuteInput,
  providerId: string,
  startedAt: string,
  errorClass: ErrorClass,
) {
  const endedAt = new Date().toISOString();
  const attempt = {
    attemptIndex: 0,
    providerId,
    modelId: input.modelId,
    startedAt,
    endedAt,
    latencyMs: Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime()),
    inputTokens: null,
    outputTokens: null,
    errorClass,
    estimatedCostUsd: "0",
    actualCostUsd: null,
    pricingTableVersionId: input.pricingTable.versionId,
  };
  return { kind: "failure" as const, attempt };
}

/** Test helper: forces the next probeHealth() to report unhealthy. */
export function markMockUnhealthy(adapter: ProviderAdapter, unhealthy: boolean): void {
  const target = adapter as unknown as { __mock?: { setUnhealthy(v: boolean): void } };
  target.__mock?.setUnhealthy(unhealthy);
}

/** Convenience: create both mock providers used by quickstart + tests. */
export function createDefaultMockPair(): ProviderAdapter[] {
  return [
    createMockAdapter({ providerId: "mock-cheap" }),
    createMockAdapter({ providerId: "mock-fast" }),
  ];
}

export function createMockFromEnv(providerId: string): ProviderAdapter {
  const failFirst = process.env["LCA_MOCK_FAIL_FIRST"];
  const opts: MockAdapterOptions = {
    providerId,
    ...(isValidErrorClass(failFirst) ? { failFirstWith: failFirst } : {}),
  };
  return createMockAdapter(opts);
}

function isValidErrorClass(v: string | undefined): v is ErrorClass {
  return (
    v === "timeout" ||
    v === "rate_limit" ||
    v === "upstream_5xx" ||
    v === "upstream_4xx" ||
    v === "invalid_request" ||
    v === "context_exceeded" ||
    v === "override_target_missing" ||
    v === "provider_unavailable" ||
    v === "terminal_fallback_exhausted"
  );
}
