import { bench, describe } from "vitest";

import { estimateInputTokens } from "../src/evaluation/tokens.js";
import { decideRoute } from "../src/routing/decide.js";
import { executeWithFallback, type ExecuteFnInput, type ExecuteFnResult } from "../src/routing/execute-with-fallback.js";
import { resolveOverride } from "../src/overrides/resolve.js";
import { buildTelemetryEvent } from "../src/telemetry/build-event.js";
import { applyRedactionToTelemetry } from "../src/redaction/apply.js";
import type { Attempt, Model, NormalizedRequest, OperatorRule, PricingTable, RoutingDecision } from "../src/index.js";

const PRICING: PricingTable = {
  versionId: "bench-v1",
  effectiveFrom: "2026-09-08T00:00:00.000Z",
  entries: [
    { providerId: "cheap", modelId: "cheap:small", unitInputUsdPerToken: "0.0000001", unitOutputUsdPerToken: "0.0000002", currency: "USD" },
    { providerId: "cheap", modelId: "cheap:large", unitInputUsdPerToken: "0.0000005", unitOutputUsdPerToken: "0.000001", currency: "USD" },
    { providerId: "fast", modelId: "fast:default", unitInputUsdPerToken: "0.000001", unitOutputUsdPerToken: "0.000002", currency: "USD" },
    { providerId: "premium", modelId: "premium:xl", unitInputUsdPerToken: "0.00001", unitOutputUsdPerToken: "0.00003", currency: "USD" },
  ],
};

const CATALOG: Model[] = [
  {
    modelId: "cheap:small", providerId: "cheap", capabilities: ["json_mode"],
    contextWindow: 8_000, qualityTier: "standard",
    publishedLatencyProfile: { p50Ms: 200, p95Ms: 500 },
    publishedReliabilityScore: 0.98, pricingDescriptorRef: "cheap:small",
  },
  {
    modelId: "cheap:large", providerId: "cheap", capabilities: ["json_mode", "tool_use"],
    contextWindow: 32_000, qualityTier: "high",
    publishedLatencyProfile: { p50Ms: 400, p95Ms: 900 },
    publishedReliabilityScore: 0.99, pricingDescriptorRef: "cheap:large",
  },
  {
    modelId: "fast:default", providerId: "fast", capabilities: ["json_mode", "function_calling"],
    contextWindow: 16_000, qualityTier: "standard",
    publishedLatencyProfile: { p50Ms: 40, p95Ms: 120 },
    publishedReliabilityScore: 0.97, pricingDescriptorRef: "fast:default",
  },
  {
    modelId: "premium:xl", providerId: "premium",
    capabilities: ["json_mode", "tool_use", "function_calling", "vision"],
    contextWindow: 128_000, qualityTier: "high",
    publishedLatencyProfile: { p50Ms: 700, p95Ms: 2_000 },
    publishedReliabilityScore: 0.995, pricingDescriptorRef: "premium:xl",
  },
];

function mkRequest(): NormalizedRequest {
  return {
    requestId: "01924b1a-4c9f-7000-b000-000000000001",
    clientId: "bench",
    receivedAt: "2026-09-08T00:00:00.000Z",
    messages: [{ role: "user", content: "hi ".repeat(50) }],
    requirements: { requiredCapabilities: [] },
    override: null,
    estimatedInputTokens: 50,
  };
}

describe("routing pipeline overhead (T097 / SC-007)", () => {
  const request = mkRequest();
  bench("decideRoute over 4-model catalog", () => {
    decideRoute({ request, catalog: CATALOG, pricingTable: PRICING });
  });

  bench("estimateInputTokens over ~150-char message", () => {
    estimateInputTokens(request.messages);
  });

  bench("full pipeline: estimate + decide", () => {
    const est = estimateInputTokens(request.messages);
    decideRoute({
      request: { ...request, estimatedInputTokens: est },
      catalog: CATALOG,
      pricingTable: PRICING,
    });
  });
});

// Core computation only: no provider network, no DB. The `execute` fn below is a
// deterministic in-memory stub so fallback ORCHESTRATION is measured, not
// provider latency (which SC-007 explicitly excludes from routing overhead).
function mkAttempt(providerId: string, modelId: string, attemptIndex: number, errorClass: Attempt["errorClass"]): Attempt {
  return {
    attemptIndex,
    providerId,
    modelId,
    startedAt: "2026-09-08T00:00:00.000Z",
    endedAt: "2026-09-08T00:00:00.050Z",
    latencyMs: 50,
    inputTokens: errorClass === "none" ? 50 : null,
    outputTokens: errorClass === "none" ? 12 : null,
    errorClass,
    estimatedCostUsd: errorClass === "none" ? "0.0005" : "0",
    actualCostUsd: errorClass === "none" ? "0.0005" : null,
    pricingTableVersionId: PRICING.versionId,
  };
}

describe("core completion path overhead (SC-007, core only)", () => {
  const request = mkRequest();
  const decision: RoutingDecision = decideRoute({ request, catalog: CATALOG, pricingTable: PRICING });

  const operatorRules: OperatorRule[] = [
    {
      ruleId: "rule_bench",
      priority: 10,
      match: { clientIds: ["bench"], requiredCapabilities: null, minEstimatedTokens: null, maxEstimatedTokens: null },
      pin: { providerId: "fast", modelId: "fast:default" },
      enabled: true,
      createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T00:00:00.000Z",
    },
  ];

  const successAttempts = [mkAttempt("cheap", "cheap:small", 0, "none")];
  const fallbackAttempts = [mkAttempt("cheap", "cheap:small", 0, "upstream_5xx"), mkAttempt("fast", "fast:default", 1, "none")];
  const builtEvent = buildTelemetryEvent({
    eventId: "01924b1a-4c9f-7000-b000-000000000001",
    receivedAt: request.receivedAt,
    clientId: request.clientId,
    decision,
    attempts: successAttempts,
    totalLatencyMs: 60,
  });

  // Deterministic execute stubs (no provider, no network).
  const executeOk = async (i: ExecuteFnInput): Promise<ExecuteFnResult> => ({
    kind: "success",
    content: "ok",
    finishReason: "stop",
    attempt: mkAttempt(i.providerId, i.modelId, i.attemptIndex, "none"),
  });
  const executeFailThenOk = async (i: ExecuteFnInput): Promise<ExecuteFnResult> =>
    i.attemptIndex === 0
      ? { kind: "failure", attempt: mkAttempt(i.providerId, i.modelId, 0, "upstream_5xx") }
      : { kind: "success", content: "ok", finishReason: "stop", attempt: mkAttempt(i.providerId, i.modelId, i.attemptIndex, "none") };

  bench("resolveOverride: operator rule match (precedence)", () => {
    resolveOverride({ request, rules: operatorRules });
  });

  bench("resolveOverride: autopilot (no rules)", () => {
    resolveOverride({ request, rules: [] });
  });

  bench("executeWithFallback: single success (stub execute)", async () => {
    await executeWithFallback({ request, decision, pricingTable: PRICING, execute: executeOk });
  });

  bench("executeWithFallback: one fallback (stub execute)", async () => {
    await executeWithFallback({ request, decision, pricingTable: PRICING, execute: executeFailThenOk });
  });

  bench("buildTelemetryEvent: single-attempt success", () => {
    buildTelemetryEvent({ eventId: request.requestId, receivedAt: request.receivedAt, clientId: request.clientId, decision, attempts: successAttempts, totalLatencyMs: 60 });
  });

  bench("buildTelemetryEvent: two-attempt fallback", () => {
    buildTelemetryEvent({ eventId: request.requestId, receivedAt: request.receivedAt, clientId: request.clientId, decision, attempts: fallbackAttempts, totalLatencyMs: 130 });
  });

  bench("applyRedactionToTelemetry", () => {
    applyRedactionToTelemetry(builtEvent);
  });

  // End-to-end CORE path (autopilot, success): estimate → resolve → decide →
  // execute(stub) → build event → redact. Excludes provider network + DB.
  bench("full core path: resolve + estimate + decide + execute + build + redact", async () => {
    const resolution = resolveOverride({ request, rules: [] });
    const est = estimateInputTokens(request.messages);
    const d = resolution.pin
      ? decision
      : decideRoute({ request: { ...request, estimatedInputTokens: est }, catalog: CATALOG, pricingTable: PRICING });
    const outcome = await executeWithFallback({ request, decision: d, pricingTable: PRICING, execute: executeOk });
    const ev = buildTelemetryEvent({ eventId: request.requestId, receivedAt: request.receivedAt, clientId: request.clientId, decision: d, attempts: outcome.attempts, totalLatencyMs: 60 });
    applyRedactionToTelemetry(ev);
  });
});

