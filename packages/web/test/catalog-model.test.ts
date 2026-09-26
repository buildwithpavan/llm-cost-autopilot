import { describe, expect, it } from "vitest";
import type { CatalogModel } from "../src/lib/api/catalog";
import {
  QUALITY_TIERS,
  deriveProviderSummary,
  formatReliabilityPct,
  pricingVersion,
  publishedLatency,
  publishedReliability,
} from "../src/features/catalog/catalog-model";

function model(over: Partial<CatalogModel>): CatalogModel {
  return {
    providerId: "mock-cheap",
    modelId: "mock-cheap:small",
    qualityTier: "standard",
    capabilities: [],
    contextWindow: 8000,
    ...over,
  };
}

describe("published latency", () => {
  it("returns the profile when present", () => {
    expect(publishedLatency(model({ publishedLatencyProfile: { p50Ms: 120, p95Ms: 400 } }))).toEqual({
      p50Ms: 120,
      p95Ms: 400,
    });
  });

  it("returns null (unavailable) when absent — never zero", () => {
    expect(publishedLatency(model({}))).toBeNull();
  });

  it("returns null when the shape is malformed", () => {
    expect(publishedLatency(model({ publishedLatencyProfile: { p50Ms: 5 } as unknown as { p50Ms: number; p95Ms: number } }))).toBeNull();
  });
});

describe("published reliability", () => {
  it("returns the score when present", () => {
    expect(publishedReliability(model({ publishedReliabilityScore: 0.999 }))).toBe(0.999);
  });

  it("returns null (unavailable) when absent — never zero", () => {
    expect(publishedReliability(model({}))).toBeNull();
  });

  it("distinguishes a real 0 score from unavailable", () => {
    expect(publishedReliability(model({ publishedReliabilityScore: 0 }))).toBe(0);
  });

  it("formats as a percentage", () => {
    expect(formatReliabilityPct(0.999)).toBe("99.9%");
    expect(formatReliabilityPct(1)).toBe("100.0%");
    expect(formatReliabilityPct(0.95)).toBe("95.0%");
  });
});

describe("deriveProviderSummary", () => {
  it("groups models by provider with counts, capability union, and tier spread", () => {
    const summaries = deriveProviderSummary([
      model({ providerId: "mock-cheap", modelId: "mock-cheap:small", qualityTier: "standard", capabilities: ["tool_use"] }),
      model({ providerId: "mock-cheap", modelId: "mock-cheap:large", qualityTier: "high", capabilities: ["vision", "tool_use"] }),
      model({ providerId: "mock-fast", modelId: "mock-fast:default", qualityTier: "low", capabilities: ["json_mode"] }),
    ]);
    expect(summaries.map((s) => s.providerId)).toEqual(["mock-cheap", "mock-fast"]);
    const cheap = summaries[0]!;
    expect(cheap.modelCount).toBe(2);
    expect(cheap.capabilities).toEqual(["tool_use", "vision"]);
    expect(cheap.tierCounts).toEqual({ low: 0, standard: 1, high: 1 });
    const fast = summaries[1]!;
    expect(fast.modelCount).toBe(1);
    expect(fast.tierCounts).toEqual({ low: 1, standard: 0, high: 0 });
  });

  it("orders providers deterministically by id ascending", () => {
    const summaries = deriveProviderSummary([
      model({ providerId: "zeta" }),
      model({ providerId: "alpha" }),
    ]);
    expect(summaries.map((s) => s.providerId)).toEqual(["alpha", "zeta"]);
  });

  it("produces no providers for an empty catalog", () => {
    expect(deriveProviderSummary([])).toEqual([]);
  });

  it("dedupes and sorts the capability union", () => {
    const summaries = deriveProviderSummary([
      model({ providerId: "p", capabilities: ["vision", "tool_use"] }),
      model({ providerId: "p", capabilities: ["tool_use", "json_mode"] }),
    ]);
    expect(summaries[0]!.capabilities).toEqual(["json_mode", "tool_use", "vision"]);
  });
});

describe("pricingVersion", () => {
  it("returns the version when present", () => {
    expect(pricingVersion({ pricingTableVersionId: "seed-2026-09-08" })).toBe("seed-2026-09-08");
  });

  it("returns null (unavailable) when missing or blank — never fabricated", () => {
    expect(pricingVersion({ pricingTableVersionId: "" })).toBeNull();
    expect(pricingVersion(null)).toBeNull();
    expect(pricingVersion({ pricingTableVersionId: undefined as unknown as string })).toBeNull();
  });
});

describe("model presentation fields", () => {
  it("preserves provider/model identity and tier verbatim", () => {
    const m = model({ providerId: "mock-fast", modelId: "mock-fast:default", qualityTier: "low" });
    expect(m.providerId).toBe("mock-fast");
    expect(m.modelId).toBe("mock-fast:default");
    expect(QUALITY_TIERS).toContain(m.qualityTier);
  });

  it("supports all capability values and empty capabilities", () => {
    expect(model({ capabilities: ["tool_use", "json_mode", "function_calling", "vision"] }).capabilities).toEqual([
      "tool_use",
      "json_mode",
      "function_calling",
      "vision",
    ]);
    expect(model({ capabilities: [] }).capabilities).toEqual([]);
  });

  it("tolerates unknown optional wire fields without throwing", () => {
    const m = model({ pricingDescriptorRef: "descriptor-xyz" } as Partial<CatalogModel>);
    expect(publishedLatency(m)).toBeNull();
    expect(publishedReliability(m)).toBeNull();
    // pricingDescriptorRef is opaque and never surfaced as a price.
    expect(m.pricingDescriptorRef).toBe("descriptor-xyz");
  });
});
