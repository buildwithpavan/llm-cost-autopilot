import type { RoutingDecision } from "@/types";

/**
 * "With LCA" vs "without LCA" savings for a single routed request.
 *
 * The baseline ("without LCA") is the most expensive candidate the request
 * could legitimately have used — i.e. what a naive integration that always
 * reaches for a premium model would have paid. The chosen cost ("with LCA") is
 * the autopilot-selected candidate. Both figures are priced identically by the
 * backend (same estimator, same token estimate), so the comparison is fair.
 */
export interface SavingsEnvelope {
  /** Cost of the chosen candidate ("with LCA"). */
  chosenCostUsd: number;
  /** Cost of the most expensive viable candidate ("without LCA"). */
  baselineCostUsd: number;
  savingsUsd: number;
  /** 0..100. */
  savingsPct: number;
  baselineProviderId: string | null;
  baselineModelId: string | null;
  /** True only when at least two priced candidates exist to compare. */
  comparable: boolean;
}

export function computeSavings(decision: RoutingDecision): SavingsEnvelope {
  const chosenCostUsd = Number(decision.estimatedCostUsd);
  const priced = decision.candidateRanking.filter(
    (c): c is typeof c & { estimatedCostUsd: string } =>
      c.included && c.estimatedCostUsd != null,
  );

  if (priced.length < 2) {
    return {
      chosenCostUsd,
      baselineCostUsd: chosenCostUsd,
      savingsUsd: 0,
      savingsPct: 0,
      baselineProviderId: null,
      baselineModelId: null,
      comparable: false,
    };
  }

  let baseline = priced[0]!;
  for (const c of priced) {
    if (Number(c.estimatedCostUsd) > Number(baseline.estimatedCostUsd)) baseline = c;
  }
  const baselineCostUsd = Number(baseline.estimatedCostUsd);
  const savingsUsd = Math.max(0, baselineCostUsd - chosenCostUsd);
  const savingsPct = baselineCostUsd > 0 ? (savingsUsd / baselineCostUsd) * 100 : 0;

  return {
    chosenCostUsd,
    baselineCostUsd,
    savingsUsd,
    savingsPct,
    baselineProviderId: baseline.providerId,
    baselineModelId: baseline.modelId,
    comparable: true,
  };
}
