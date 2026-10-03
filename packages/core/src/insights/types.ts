import type { QualityTier } from "../types/request.js";
import type { Model, PricingTable } from "../types/catalog.js";

/**
 * Advisory cost-optimization insight types (Phase 15). These are strictly
 * observational: they surface facts and potential cost differences derived from
 * authoritative pricing, telemetry, and budget data. They never recommend an
 * automatic routing change, mutate budgets, or claim behavioral equivalence.
 */
export type InsightType = "cost_concentration" | "pricing_comparison" | "budget_pressure";

export type InsightSeverity = "info" | "warning" | "critical";

/**
 * Whether the existing catalog establishes a conservative eligibility signal
 * between an observed model and a priced alternative. `catalog_superset` means
 * the alternative meets or exceeds the observed model's capabilities, context
 * window, and quality tier per catalog metadata — a catalog signal only, never
 * a guarantee of request-level routing compatibility.
 */
export type CompatibilitySignal = "none" | "catalog_superset";

export interface CostConcentrationInsight {
  readonly type: "cost_concentration";
  readonly id: string;
  readonly severity: InsightSeverity;
  readonly title: string;
  readonly description: string;
  readonly providerId: string;
  readonly modelId: string;
  /** Estimated spend attributed to this provider/model in the window. */
  readonly estimatedCostUsd: string;
  /** Total estimated spend across the window (denominator). */
  readonly totalEstimatedCostUsd: string;
  /** estimatedCostUsd / totalEstimatedCostUsd as an exact 6-dp ratio string. */
  readonly shareRatio: string;
  readonly requestCount: number;
}

export interface PricingComparisonInsight {
  readonly type: "pricing_comparison";
  readonly id: string;
  readonly severity: InsightSeverity;
  readonly title: string;
  readonly description: string;
  /** Observed provider/model (the population under comparison). */
  readonly providerId: string;
  readonly modelId: string;
  readonly observedRequestCount: number;
  readonly observedInputTokens: number;
  readonly observedOutputTokens: number;
  /** Recorded estimated spend for the observed population (telemetry basis). */
  readonly observedEstimatedCostUsd: string;
  /** Observed model priced under the CURRENT catalog for the observed token volume (comparison basis). */
  readonly currentPricedCostUsd: string;
  readonly alternativeProviderId: string;
  readonly alternativeModelId: string;
  /** Alternative model priced under the current catalog for the SAME observed token volume. */
  readonly counterfactualEstimatedCostUsd: string;
  /** currentPricedCostUsd − counterfactualEstimatedCostUsd (positive ⇒ alternative is cheaper). */
  readonly costDifferenceUsd: string;
  readonly compatibilitySignal: CompatibilitySignal;
  /** Explicit, human-readable assumptions underpinning the comparison. */
  readonly assumptions: readonly string[];
}

export interface BudgetPressureInsight {
  readonly type: "budget_pressure";
  readonly id: string;
  readonly severity: InsightSeverity;
  readonly title: string;
  readonly description: string;
  readonly budgetId: string;
  readonly scope: "global" | "client";
  readonly clientId: string | null;
  readonly period: string;
  readonly action: string;
  readonly limitUsd: string;
  readonly currentSpendUsd: string;
  readonly remainingUsd: string;
  readonly utilization: string;
  readonly status: "below_limit" | "at_limit" | "over_limit";
}

export type OptimizationInsight =
  | CostConcentrationInsight
  | PricingComparisonInsight
  | BudgetPressureInsight;

/** Per-model aggregate spend (from the existing telemetry summary aggregation). */
export interface OptimizationModelSpend {
  readonly providerId: string;
  readonly modelId: string;
  readonly requestCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: string;
}

/** Budget status (from the existing budget-status computation). */
export interface OptimizationBudgetStatus {
  readonly budgetId: string;
  readonly scope: "global" | "client";
  readonly clientId: string | null;
  readonly period: string;
  readonly action: string;
  readonly limitUsd: string;
  readonly currentSpendUsd: string;
  readonly remainingUsd: string;
  readonly utilization: string;
  readonly status: "below_limit" | "at_limit" | "over_limit";
}

export interface OptimizationConfig {
  /** Minimum share of window spend (6-dp ratio string) for a concentration insight. */
  readonly concentrationRatioThreshold: string;
  /** Absolute floor (USD string) below which a model's spend is ignored (noise suppression). */
  readonly minSpendUsd: string;
  /** Minimum budget utilization (6-dp ratio string) that counts as budget pressure. */
  readonly budgetPressureRatioThreshold: string;
  /** Minimum cost difference (USD string) for a pricing-comparison insight to surface. */
  readonly pricingComparisonMinDeltaUsd: string;
  /** Maximum priced alternatives surfaced per observed model (bounded fan-out). */
  readonly maxPricingAlternatives: number;
}

export interface GenerateOptimizationInsightsInput {
  readonly totalEstimatedCostUsd: string;
  readonly byModel: readonly OptimizationModelSpend[];
  readonly catalog: readonly Model[];
  readonly pricingTable: PricingTable;
  readonly budgets: readonly OptimizationBudgetStatus[];
  readonly config: OptimizationConfig;
}

export const QUALITY_RANK: Record<QualityTier, number> = { low: 0, standard: 1, high: 2 };

export const SEVERITY_RANK: Record<InsightSeverity, number> = { info: 0, warning: 1, critical: 2 };
