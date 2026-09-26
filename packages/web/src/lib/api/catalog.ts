import { apiRequest } from "./client.js";

/** Subset of the @lca/core Model fields the frontend consumes from GET /v1/catalog. */
export interface CatalogModel {
  providerId: string;
  modelId: string;
  qualityTier: "low" | "standard" | "high";
  capabilities: string[];
  contextWindow: number;
  /** STATIC published spec (not live telemetry). Already on the wire; typed defensively. */
  publishedLatencyProfile?: { p50Ms: number; p95Ms: number };
  /** STATIC published spec in 0..1 (not live health). Already on the wire; typed defensively. */
  publishedReliabilityScore?: number;
  /** Opaque pricing reference — NOT a price. Already on the wire; typed defensively. */
  pricingDescriptorRef?: string;
}

/** Mirrors GET /v1/catalog. Only the active pricing version id is exposed (not per-entry prices). */
export interface CatalogResponse {
  pricingTableVersionId: string;
  models: CatalogModel[];
}

export function getCatalog(opts: { apiKey?: string; signal?: AbortSignal } = {}): Promise<CatalogResponse> {
  const reqOpts: { apiKey?: string; signal?: AbortSignal } = {};
  if (opts.apiKey) reqOpts.apiKey = opts.apiKey;
  if (opts.signal) reqOpts.signal = opts.signal;
  return apiRequest<CatalogResponse>("/v1/catalog", reqOpts);
}
