import { z } from "zod";

export const capabilitySchema = z.enum([
  "tool_use",
  "json_mode",
  "function_calling",
  "vision",
]);
export type Capability = z.infer<typeof capabilitySchema>;

export const qualityTierSchema = z.enum(["low", "standard", "high"]);
export type QualityTier = z.infer<typeof qualityTierSchema>;

export const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});
export type Message = z.infer<typeof messageSchema>;

export const requestRequirementsSchema = z
  .object({
    maxLatencyMs: z.number().int().positive().nullable().optional(),
    // Decimal cost expressed as a string to preserve precision on the wire.
    maxCostUsd: z.string().regex(/^\d+(\.\d+)?$/).nullable().optional(),
    minQualityTier: qualityTierSchema.nullable().optional(),
    requiredCapabilities: z.array(capabilitySchema).default([]),
  })
  .default({});
export type RequestRequirements = z.infer<typeof requestRequirementsSchema>;

export const clientOverrideSchema = z
  .object({
    providerId: z.string().min(1).nullable().optional(),
    modelId: z.string().min(1).nullable().optional(),
  })
  .refine((o) => (o.providerId ?? null) !== null || (o.modelId ?? null) !== null, {
    message: "override must set providerId or modelId",
  });
export type ClientOverride = z.infer<typeof clientOverrideSchema>;

/** Shape a client sends over the wire. `requestId` is filled at ingress. */
export const completionRequestSchema = z.object({
  messages: z.array(messageSchema).min(1),
  requirements: requestRequirementsSchema.optional(),
  override: clientOverrideSchema.nullable().optional(),
});
export type CompletionRequest = z.infer<typeof completionRequestSchema>;

/** Internal normalized request. */
export const normalizedRequestSchema = z.object({
  requestId: z.string().uuid(),
  clientId: z.string().min(1),
  receivedAt: z.string().datetime(),
  messages: z.array(messageSchema).min(1),
  requirements: requestRequirementsSchema,
  override: clientOverrideSchema.nullable(),
  estimatedInputTokens: z.number().int().nonnegative(),
});
export type NormalizedRequest = z.infer<typeof normalizedRequestSchema>;

export const normalizedResponseSchema = z.object({
  requestId: z.string().uuid(),
  providerId: z.string(),
  modelId: z.string(),
  content: z.string(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  finishReason: z.string(),
});
export type NormalizedResponse = z.infer<typeof normalizedResponseSchema>;
