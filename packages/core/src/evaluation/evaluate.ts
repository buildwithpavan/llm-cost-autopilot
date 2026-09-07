import type { CandidateScore } from "../types/telemetry.js";
import type { Model } from "../types/catalog.js";
import type { NormalizedRequest } from "../types/request.js";

export function filterCandidates(
  request: NormalizedRequest,
  catalog: readonly Model[],
): CandidateScore[] {
  const results: CandidateScore[] = [];
  for (const model of catalog) {
    let included = true;
    let reason: string | null = null;

    // Capability filter
    for (const capability of request.requirements.requiredCapabilities ?? []) {
      if (!model.capabilities.includes(capability)) {
        included = false;
        reason = `missing required capability: ${capability}`;
        break;
      }
    }

    // Context window filter
    if (included && request.estimatedInputTokens > model.contextWindow) {
      included = false;
      reason = `context window ${model.contextWindow} < estimated tokens ${request.estimatedInputTokens}`;
    }

    // Latency ceiling
    const maxLat = request.requirements.maxLatencyMs;
    if (included && typeof maxLat === "number" && model.publishedLatencyProfile.p95Ms > maxLat) {
      included = false;
      reason = `published p95 latency ${model.publishedLatencyProfile.p95Ms}ms exceeds ceiling ${maxLat}ms`;
    }

    // Quality tier filter
    const minTier = request.requirements.minQualityTier;
    if (included && minTier) {
      const order: Record<Model["qualityTier"], number> = { low: 0, standard: 1, high: 2 };
      if (order[model.qualityTier] < order[minTier]) {
        included = false;
        reason = `quality tier ${model.qualityTier} below required ${minTier}`;
      }
    }

    results.push({
      providerId: model.providerId,
      modelId: model.modelId,
      included,
      exclusionReason: reason,
      scoreBreakdown: {},
    });
  }
  return results;
}
