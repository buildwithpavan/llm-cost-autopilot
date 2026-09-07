import { z } from "zod";

import { capabilitySchema } from "./request.js";

export const ruleMatchSchema = z.object({
  clientIds: z.array(z.string()).nullable().default(null),
  requiredCapabilities: z.array(capabilitySchema).nullable().default(null),
  minEstimatedTokens: z.number().int().nonnegative().nullable().default(null),
  maxEstimatedTokens: z.number().int().nonnegative().nullable().default(null),
});
export type RuleMatch = z.infer<typeof ruleMatchSchema>;

export const rulePinSchema = z
  .object({
    providerId: z.string().min(1).nullable().default(null),
    modelId: z.string().min(1).nullable().default(null),
  })
  .refine((p) => p.providerId !== null || p.modelId !== null, {
    message: "pin must include providerId or modelId",
  });
export type RulePin = z.infer<typeof rulePinSchema>;

export const operatorRuleInputSchema = z.object({
  priority: z.number().int(),
  match: ruleMatchSchema,
  pin: rulePinSchema,
  enabled: z.boolean().default(true),
});
export type OperatorRuleInput = z.infer<typeof operatorRuleInputSchema>;

export const operatorRuleSchema = operatorRuleInputSchema.extend({
  ruleId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type OperatorRule = z.infer<typeof operatorRuleSchema>;

export const providerHealthStateSchema = z.object({
  providerId: z.string(),
  healthy: z.boolean(),
  lastProbedAt: z.string().datetime(),
  consecutiveFailures: z.number().int().nonnegative(),
});
export type ProviderHealthState = z.infer<typeof providerHealthStateSchema>;

export const apiKeyMetadataSchema = z.object({
  keyId: z.string(),
  clientId: z.string(),
  label: z.string(),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
  lastUsedAt: z.string().datetime().nullable(),
});
export type ApiKeyMetadata = z.infer<typeof apiKeyMetadataSchema>;
