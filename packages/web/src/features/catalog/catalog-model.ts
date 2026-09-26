import type { CatalogModel, CatalogResponse } from "../../lib/api/catalog.js";

export type QualityTier = "low" | "standard" | "high";

/** Canonical (non-evaluative) tier order for stable display, NOT a ranking. */
export const QUALITY_TIERS: readonly QualityTier[] = ["low", "standard", "high"];

export interface PublishedLatency {
  p50Ms: number;
  p95Ms: number;
}

/** Returns the published (static) latency profile, or null when not on the wire. */
export function publishedLatency(model: CatalogModel): PublishedLatency | null {
  const p = model.publishedLatencyProfile;
  if (!p || typeof p.p50Ms !== "number" || typeof p.p95Ms !== "number") return null;
  return { p50Ms: p.p50Ms, p95Ms: p.p95Ms };
}

/** Returns the published (static) reliability score in 0..1, or null when absent. */
export function publishedReliability(model: CatalogModel): number | null {
  const r = model.publishedReliabilityScore;
  return typeof r === "number" && Number.isFinite(r) ? r : null;
}

/** Formats a 0..1 reliability score as a percentage. Caller guarantees non-null. */
export function formatReliabilityPct(score: number): string {
  return `${(score * 100).toFixed(1)}%`;
}

export interface ProviderSummary {
  providerId: string;
  modelCount: number;
  /** Sorted union of capabilities across the provider's catalog models. */
  capabilities: string[];
  /** Count of models per quality tier (spread, not a ranking). */
  tierCounts: Record<QualityTier, number>;
}

/**
 * Derives a provider summary strictly from catalog models. Providers are not a
 * backend entity — this only groups what the catalog already returned.
 */
export function deriveProviderSummary(models: readonly CatalogModel[]): ProviderSummary[] {
  const map = new Map<string, { count: number; caps: Set<string>; tiers: Record<QualityTier, number> }>();
  for (const m of models) {
    let g = map.get(m.providerId);
    if (!g) {
      g = { count: 0, caps: new Set<string>(), tiers: { low: 0, standard: 0, high: 0 } };
      map.set(m.providerId, g);
    }
    g.count += 1;
    for (const c of m.capabilities) g.caps.add(c);
    if (m.qualityTier === "low" || m.qualityTier === "standard" || m.qualityTier === "high") {
      g.tiers[m.qualityTier] += 1;
    }
  }
  return [...map.entries()]
    .map(([providerId, g]) => ({
      providerId,
      modelCount: g.count,
      capabilities: [...g.caps].sort(),
      tierCounts: g.tiers,
    }))
    .sort((a, b) => (a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0));
}

/** Active pricing-table version, or null when unavailable (never blank/zero). */
export function pricingVersion(catalog: Pick<CatalogResponse, "pricingTableVersionId"> | null): string | null {
  const v = catalog?.pricingTableVersionId;
  return typeof v === "string" && v.length > 0 ? v : null;
}
