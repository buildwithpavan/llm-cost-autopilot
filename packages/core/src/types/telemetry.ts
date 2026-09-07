import { z } from "zod";

export const errorClassSchema = z.enum([
  "none",
  "timeout",
  "rate_limit",
  "upstream_5xx",
  "upstream_4xx",
  "invalid_request",
  "context_exceeded",
  "override_target_missing",
  "provider_unavailable",
  "terminal_fallback_exhausted",
]);
export type ErrorClass = z.infer<typeof errorClassSchema>;

export const rationaleEntrySchema = z.object({
  factor: z.string().min(1),
  verdict: z.enum(["eliminated", "preferred", "neutral"]),
  note: z.string(),
});
export type RationaleEntry = z.infer<typeof rationaleEntrySchema>;

export const candidateScoreSchema = z.object({
  providerId: z.string(),
  modelId: z.string(),
  included: z.boolean(),
  exclusionReason: z.string().nullable().default(null),
  scoreBreakdown: z.record(z.string(), z.number()),
});
export type CandidateScore = z.infer<typeof candidateScoreSchema>;

export const decisionSourceSchema = z.enum(["autopilot", "client_override", "operator_rule"]);
export type DecisionSource = z.infer<typeof decisionSourceSchema>;

export const shadowedSourceSchema = z.enum(["client_override"]).nullable();

export const routingDecisionSchema = z.object({
  decisionSource: decisionSourceSchema,
  shadowedSource: shadowedSourceSchema,
  candidateRanking: z.array(candidateScoreSchema),
  chosenModelId: z.string(),
  chosenProviderId: z.string(),
  rationale: z.array(rationaleEntrySchema),
  pricingTableVersionId: z.string(),
  estimatedCostUsd: z.string(),
});
export type RoutingDecision = z.infer<typeof routingDecisionSchema>;

export const attemptSchema = z.object({
  attemptIndex: z.number().int().nonnegative(),
  providerId: z.string(),
  modelId: z.string(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  latencyMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  errorClass: errorClassSchema,
  estimatedCostUsd: z.string(),
  actualCostUsd: z.string().nullable(),
  pricingTableVersionId: z.string(),
  // Optional raw provider payload for debugging; MUST pass through redaction
  // before persistence (enforced by applyRedactionToTelemetry).
  raw: z.unknown().optional(),
});
export type Attempt = z.infer<typeof attemptSchema>;

export const telemetryEventSchema = z.object({
  eventId: z.string().uuid(),
  receivedAt: z.string().datetime(),
  clientId: z.string(),
  decisionSource: decisionSourceSchema,
  shadowedSource: shadowedSourceSchema.default(null),
  effectiveProviderId: z.string(),
  effectiveModelId: z.string(),
  attempts: z.array(attemptSchema).min(1).max(2),
  aggregatedInputTokens: z.number().int().nonnegative(),
  aggregatedOutputTokens: z.number().int().nonnegative(),
  totalLatencyMs: z.number().int().nonnegative(),
  terminalErrorClass: errorClassSchema,
  estimatedCostUsd: z.string(),
  actualCostUsd: z.string().nullable(),
  pricingTableVersionId: z.string(),
  reconciled: z.boolean().nullable(),
  routingRationale: routingDecisionSchema,
});
export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

export const telemetryRollupSchema = z.object({
  rollupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  providerId: z.string(),
  modelId: z.string(),
  requestCount: z.number().int().nonnegative(),
  terminalErrorCounts: z.record(errorClassSchema, z.number().int().nonnegative()),
  inputTokensSum: z.number().int().nonnegative(),
  outputTokensSum: z.number().int().nonnegative(),
  estimatedCostSumUsd: z.string(),
  actualCostSumUsd: z.string(),
  latencyPercentilesMs: z.object({
    p50: z.number().int().nonnegative(),
    p95: z.number().int().nonnegative(),
    p99: z.number().int().nonnegative(),
  }),
  reconciledRate: z.number().min(0).max(1),
  decisionSourceCounts: z.record(decisionSourceSchema, z.number().int().nonnegative()),
  aggregatedAt: z.string().datetime(),
});
export type TelemetryRollup = z.infer<typeof telemetryRollupSchema>;
