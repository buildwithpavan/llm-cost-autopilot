import { Decimal } from "../cost/decimal.js";
import { estimateCostUsd } from "../cost/estimate.js";
import { filterCandidates } from "../evaluation/evaluate.js";
import type { Model, PricingTable } from "../types/catalog.js";
import type { NormalizedRequest } from "../types/request.js";
import type {
  RationaleEntry,
  RoutingDecision,
} from "../types/telemetry.js";

export interface DecideInput {
  request: NormalizedRequest;
  catalog: readonly Model[];
  pricingTable: PricingTable;
}

/**
 * Deterministic scoring. Each factor produces a score in [0, 1] where higher is better.
 * Weights are hand-tuned and constant.
 */
const WEIGHTS = {
  cost: 0.7,
  latency: 0.1,
  quality: 0.05,
  reliability: 0.1,
  capability: 0.05,
} as const;

const QUALITY_ORDER: Record<Model["qualityTier"], number> = { low: 0, standard: 0.6, high: 1 };

function scoreCandidate(
  model: Model,
  request: NormalizedRequest,
  pricingTable: PricingTable,
  minCost: number,
  maxCost: number,
): Record<string, number> {
  const estimatedCost = estimateCostUsd({
    table: pricingTable,
    providerId: model.providerId,
    modelId: model.modelId,
    inputTokens: request.estimatedInputTokens,
    outputTokens: Math.max(4, Math.floor(request.estimatedInputTokens / 4)),
  });
  const cost = Number(estimatedCost);
  const costScore =
    maxCost === minCost ? 1 : 1 - (cost - minCost) / Math.max(1e-9, maxCost - minCost);

  const latencyP95 = model.publishedLatencyProfile.p95Ms;
  const latencyScore = 1 / (1 + latencyP95 / 200); // 200ms → 0.5

  const qualityScore = QUALITY_ORDER[model.qualityTier];
  const reliabilityScore = model.publishedReliabilityScore;

  const requiredCaps = request.requirements.requiredCapabilities ?? [];
  const capabilityScore =
    requiredCaps.length === 0
      ? 1
      : requiredCaps.every((c) => model.capabilities.includes(c))
        ? 1
        : 0;

  const total =
    costScore * WEIGHTS.cost +
    latencyScore * WEIGHTS.latency +
    qualityScore * WEIGHTS.quality +
    reliabilityScore * WEIGHTS.reliability +
    capabilityScore * WEIGHTS.capability;

  return { costScore, latencyScore, qualityScore, reliabilityScore, capabilityScore, total };
}

export function decideRoute(input: DecideInput): RoutingDecision {
  if (input.catalog.length === 0) {
    throw new Error("empty catalog: no providers/models registered");
  }

  const candidates = filterCandidates(input.request, input.catalog);
  const includedModels = candidates
    .filter((c) => c.included)
    .map((c) => input.catalog.find((m) => m.modelId === c.modelId)!)
    .filter((m): m is Model => !!m);

  if (includedModels.length === 0) {
    const contextFailures = candidates.filter((c) =>
      (c.exclusionReason ?? "").toLowerCase().includes("context"),
    );
    if (contextFailures.length === candidates.length && candidates.length > 0) {
      throw new Error(
        `no candidate models can fit the request within its context window`,
      );
    }
    throw new Error("no candidate models satisfy the request requirements");
  }

  // Pre-compute cost extremes across included models to normalize the cost score.
  const includedCosts = includedModels.map((m) => {
    const c = estimateCostUsd({
      table: input.pricingTable,
      providerId: m.providerId,
      modelId: m.modelId,
      inputTokens: input.request.estimatedInputTokens,
      outputTokens: Math.max(4, Math.floor(input.request.estimatedInputTokens / 4)),
    });
    return Number(c);
  });
  const minCost = Math.min(...includedCosts);
  const maxCost = Math.max(...includedCosts);

  const rationale: RationaleEntry[] = [];
  for (const c of candidates) {
    if (!c.included) {
      rationale.push({
        factor: "candidate_filter",
        verdict: "eliminated",
        note: `${c.modelId}: ${c.exclusionReason ?? "excluded"}`,
      });
      continue;
    }
    const model = input.catalog.find((m) => m.modelId === c.modelId)!;
    c.scoreBreakdown = scoreCandidate(model, input.request, input.pricingTable, minCost, maxCost);
  }

  // Rank included candidates by total score desc; tiebreak by (providerId, modelId) asc.
  const ranked = [...candidates].sort((a, b) => {
    if (!a.included && !b.included) return a.modelId.localeCompare(b.modelId);
    if (!a.included) return 1;
    if (!b.included) return -1;
    const totalDiff = (b.scoreBreakdown["total"] ?? 0) - (a.scoreBreakdown["total"] ?? 0);
    if (Math.abs(totalDiff) > 1e-9) return totalDiff;
    if (a.providerId !== b.providerId) return a.providerId.localeCompare(b.providerId);
    return a.modelId.localeCompare(b.modelId);
  });

  const winner = ranked.find((c) => c.included);
  if (!winner) throw new Error("routing failed: no winning candidate");

  const winningModel = input.catalog.find((m) => m.modelId === winner.modelId)!;
  const outputTokens = Math.max(4, Math.floor(input.request.estimatedInputTokens / 4));
  const estimatedCostUsd = estimateCostUsd({
    table: input.pricingTable,
    providerId: winner.providerId,
    modelId: winner.modelId,
    inputTokens: input.request.estimatedInputTokens,
    outputTokens,
  });

  rationale.push({
    factor: "cost",
    verdict: "preferred",
    note: `selected ${winner.modelId} with total score ${(winner.scoreBreakdown["total"] ?? 0).toFixed(4)}; estimated cost ${estimatedCostUsd} USD (weight ${WEIGHTS.cost})`,
  });
  rationale.push({
    factor: "quality",
    verdict: "neutral",
    note: `quality tier ${winningModel.qualityTier}`,
  });
  rationale.push({
    factor: "reliability",
    verdict: "neutral",
    note: `published reliability ${winningModel.publishedReliabilityScore}`,
  });

  return {
    decisionSource: "autopilot",
    shadowedSource: null,
    candidateRanking: ranked,
    chosenModelId: winner.modelId,
    chosenProviderId: winner.providerId,
    rationale,
    pricingTableVersionId: input.pricingTable.versionId,
    estimatedCostUsd,
  };
}

// exposed to silence unused-import warnings if Decimal isn't otherwise referenced
export const _decimalRef = Decimal;
