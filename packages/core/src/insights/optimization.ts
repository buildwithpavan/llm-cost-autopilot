import { Decimal } from "../cost/decimal.js";
import { estimateCostUsd, subtractUsd, ratioUsd } from "../cost/estimate.js";
import type { Model, PricingTable } from "../types/catalog.js";

import {
  QUALITY_RANK,
  SEVERITY_RANK,
  type CompatibilitySignal,
  type CostConcentrationInsight,
  type BudgetPressureInsight,
  type GenerateOptimizationInsightsInput,
  type InsightSeverity,
  type OptimizationInsight,
  type PricingComparisonInsight,
} from "./types.js";

function dec(s: string): InstanceType<typeof Decimal> {
  return new Decimal(s);
}

function isPriced(table: PricingTable, providerId: string, modelId: string): boolean {
  return table.entries.some((e) => e.providerId === providerId && e.modelId === modelId);
}

/** Conservative catalog-only eligibility signal (never a routing guarantee). */
function compatibilitySignal(observed: Model | undefined, alt: Model): CompatibilitySignal {
  if (!observed) return "none";
  const capsSuperset = observed.capabilities.every((c) => alt.capabilities.includes(c));
  const contextOk = alt.contextWindow >= observed.contextWindow;
  const qualityOk = QUALITY_RANK[alt.qualityTier] >= QUALITY_RANK[observed.qualityTier];
  return capsSuperset && contextOk && qualityOk ? "catalog_superset" : "none";
}

function concentrationInsights(
  input: GenerateOptimizationInsightsInput,
): CostConcentrationInsight[] {
  const total = dec(input.totalEstimatedCostUsd);
  if (!total.gt(0)) return [];
  const minSpend = dec(input.config.minSpendUsd);
  const threshold = dec(input.config.concentrationRatioThreshold);
  const out: CostConcentrationInsight[] = [];
  for (const group of input.byModel) {
    if (dec(group.estimatedCostUsd).lt(minSpend)) continue;
    const shareRatio = ratioUsd(group.estimatedCostUsd, input.totalEstimatedCostUsd);
    if (dec(shareRatio).lt(threshold)) continue;
    out.push({
      type: "cost_concentration",
      id: `cost_concentration:${group.providerId}:${group.modelId}`,
      severity: "warning",
      title: `Observed spend concentrated in ${group.providerId}:${group.modelId}`,
      description: `${group.providerId}:${group.modelId} accounts for a large share of estimated spend in the selected window.`,
      providerId: group.providerId,
      modelId: group.modelId,
      estimatedCostUsd: group.estimatedCostUsd,
      totalEstimatedCostUsd: input.totalEstimatedCostUsd,
      shareRatio,
      requestCount: group.requestCount,
    });
  }
  return out;
}

function pricingComparisonInsights(
  input: GenerateOptimizationInsightsInput,
): PricingComparisonInsight[] {
  const minSpend = dec(input.config.minSpendUsd);
  const minDelta = dec(input.config.pricingComparisonMinDeltaUsd);
  const maxAlternatives = Math.max(0, Math.floor(input.config.maxPricingAlternatives));
  if (maxAlternatives === 0) return [];
  const out: PricingComparisonInsight[] = [];

  for (const group of input.byModel) {
    if (dec(group.estimatedCostUsd).lt(minSpend)) continue;
    // A consistent price comparison requires the observed model to be priceable
    // under the current catalog; otherwise it is skipped (no invented basis).
    if (!isPriced(input.pricingTable, group.providerId, group.modelId)) continue;

    const currentPricedCostUsd = estimateCostUsd({
      table: input.pricingTable,
      providerId: group.providerId,
      modelId: group.modelId,
      inputTokens: group.inputTokens,
      outputTokens: group.outputTokens,
    });
    const observedModel = input.catalog.find(
      (m) => m.providerId === group.providerId && m.modelId === group.modelId,
    );

    const candidates = input.catalog
      .filter(
        (alt) =>
          !(alt.providerId === group.providerId && alt.modelId === group.modelId) &&
          isPriced(input.pricingTable, alt.providerId, alt.modelId),
      )
      .map((alt) => {
        const counterfactual = estimateCostUsd({
          table: input.pricingTable,
          providerId: alt.providerId,
          modelId: alt.modelId,
          inputTokens: group.inputTokens,
          outputTokens: group.outputTokens,
        });
        return {
          providerId: alt.providerId,
          modelId: alt.modelId,
          counterfactual,
          delta: subtractUsd(currentPricedCostUsd, counterfactual),
          compat: compatibilitySignal(observedModel, alt),
        };
      })
      .filter((c) => dec(c.delta).gte(minDelta))
      .sort((a, b) => {
        if (dec(a.delta).gt(dec(b.delta))) return -1;
        if (dec(a.delta).lt(dec(b.delta))) return 1;
        if (a.providerId !== b.providerId) return a.providerId.localeCompare(b.providerId);
        return a.modelId.localeCompare(b.modelId);
      })
      .slice(0, maxAlternatives);

    for (const alt of candidates) {
      const assumptions = [
        "Compares current catalog pricing for the observed aggregate token volume.",
        "Assumes identical input/output token usage under the alternative model.",
        alt.compat === "catalog_superset"
          ? "The alternative meets or exceeds the observed model's catalog capabilities, context window, and quality tier (a catalog signal, not a routing-compatibility guarantee)."
          : "No catalog compatibility relationship established; this is a price comparison only, not a routing recommendation.",
      ];
      out.push({
        type: "pricing_comparison",
        id: `pricing_comparison:${group.providerId}:${group.modelId}:${alt.providerId}:${alt.modelId}`,
        severity: "info",
        title: `Lower-priced catalog option for ${group.providerId}:${group.modelId}`,
        description: `A lower-priced catalog model (${alt.providerId}:${alt.modelId}) exists for the observed token volume. Potential cost difference only — not a routing or behavioral-equivalence recommendation.`,
        providerId: group.providerId,
        modelId: group.modelId,
        observedRequestCount: group.requestCount,
        observedInputTokens: group.inputTokens,
        observedOutputTokens: group.outputTokens,
        observedEstimatedCostUsd: group.estimatedCostUsd,
        currentPricedCostUsd,
        alternativeProviderId: alt.providerId,
        alternativeModelId: alt.modelId,
        counterfactualEstimatedCostUsd: alt.counterfactual,
        costDifferenceUsd: alt.delta,
        compatibilitySignal: alt.compat,
        assumptions,
      });
    }
  }
  return out;
}

function budgetPressureInsights(
  input: GenerateOptimizationInsightsInput,
): BudgetPressureInsight[] {
  const threshold = dec(input.config.budgetPressureRatioThreshold);
  const out: BudgetPressureInsight[] = [];
  for (const b of input.budgets) {
    const pressured =
      b.status === "over_limit" || b.status === "at_limit" || dec(b.utilization).gte(threshold);
    if (!pressured) continue;
    const severity: InsightSeverity = b.status === "over_limit" ? "critical" : "warning";
    const title =
      b.status === "over_limit"
        ? "Budget is over its configured limit"
        : b.status === "at_limit"
          ? "Budget has reached its configured limit"
          : "Budget is approaching its configured limit";
    out.push({
      type: "budget_pressure",
      id: `budget_pressure:${b.budgetId}`,
      severity,
      title,
      description: `The configured ${b.scope} budget (${b.period}, action=${b.action}) has consumed ${b.currentSpendUsd} of ${b.limitUsd} USD.`,
      budgetId: b.budgetId,
      scope: b.scope,
      clientId: b.clientId,
      period: b.period,
      action: b.action,
      limitUsd: b.limitUsd,
      currentSpendUsd: b.currentSpendUsd,
      remainingUsd: b.remainingUsd,
      utilization: b.utilization,
      status: b.status,
    });
  }
  return out;
}

/** Exact financial magnitude used only for deterministic ordering. */
function magnitudeUsd(insight: OptimizationInsight): string {
  switch (insight.type) {
    case "cost_concentration":
      return insight.estimatedCostUsd;
    case "pricing_comparison":
      return insight.costDifferenceUsd;
    case "budget_pressure":
      return insight.currentSpendUsd;
  }
}

/**
 * Deterministic, advisory cost-optimization insight generation. Pure: all inputs
 * are pre-aggregated by the caller (no I/O, no event scans). Monetary comparisons
 * use exact decimal arithmetic. Ordering is strictly deterministic: severity
 * (critical → warning → info), then exact financial magnitude, then stable id.
 * Nothing here mutates routing, governance, or budgets.
 */
export function generateOptimizationInsights(
  input: GenerateOptimizationInsightsInput,
): OptimizationInsight[] {
  const all: OptimizationInsight[] = [
    ...concentrationInsights(input),
    ...pricingComparisonInsights(input),
    ...budgetPressureInsights(input),
  ];
  all.sort((a, b) => {
    const severityDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (severityDelta !== 0) return severityDelta;
    const ma = dec(magnitudeUsd(a));
    const mb = dec(magnitudeUsd(b));
    if (ma.gt(mb)) return -1;
    if (ma.lt(mb)) return 1;
    return a.id.localeCompare(b.id);
  });
  return all;
}
