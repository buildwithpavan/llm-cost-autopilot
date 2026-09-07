import { z } from "zod";

import { capabilitySchema, qualityTierSchema } from "./request.js";

export const modelSchema = z.object({
  modelId: z.string().min(1),
  providerId: z.string().min(1),
  capabilities: z.array(capabilitySchema),
  contextWindow: z.number().int().positive(),
  qualityTier: qualityTierSchema,
  publishedLatencyProfile: z.object({
    p50Ms: z.number().int().nonnegative(),
    p95Ms: z.number().int().nonnegative(),
  }),
  publishedReliabilityScore: z.number().min(0).max(1),
  pricingDescriptorRef: z.string().min(1),
});
export type Model = z.infer<typeof modelSchema>;

export const pricingEntrySchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  unitInputUsdPerToken: z.string().regex(/^\d+(\.\d+)?$/),
  unitOutputUsdPerToken: z.string().regex(/^\d+(\.\d+)?$/),
  currency: z.literal("USD"),
});
export type PricingEntry = z.infer<typeof pricingEntrySchema>;

export const pricingTableSchema = z.object({
  versionId: z.string().min(1),
  effectiveFrom: z.string().datetime(),
  entries: z.array(pricingEntrySchema),
});
export type PricingTable = z.infer<typeof pricingTableSchema>;
