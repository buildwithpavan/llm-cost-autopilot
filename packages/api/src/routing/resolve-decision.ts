import {
  cost,
  overrides as coreOverrides,
  routing,
  type NormalizedRequest,
  type OperatorRule,
  type RationaleEntry,
  type RoutingDecision,
} from "@lca/core";

import { LcaError } from "../plugins/errors.js";
import type { CatalogSnapshot } from "../wiring.js";

export interface ResolveRoutingDecisionInput {
  request: NormalizedRequest;
  rules: readonly OperatorRule[];
  snapshot: CatalogSnapshot;
}

export interface ResolvedRouting {
  decision: RoutingDecision;
  resolution: coreOverrides.OverrideResolution;
}

export interface BuildRoutingDecisionInput {
  request: NormalizedRequest;
  resolution: coreOverrides.OverrideResolution;
  snapshot: CatalogSnapshot;
}

/** Verify that the target of an override or operator pin exists in the current catalog. */
function validatePinAgainstCatalog(
  pin: { providerId?: string | null; modelId?: string | null },
  snapshot: CatalogSnapshot,
): { providerId: string; modelId: string } {
  const candidates = snapshot.models.filter((m) => {
    if (pin.providerId && m.providerId !== pin.providerId) return false;
    if (pin.modelId && m.modelId !== pin.modelId) return false;
    return true;
  });
  if (candidates.length === 0) {
    throw new LcaError({
      httpStatus: 422,
      code: "override_target_missing",
      message: `override target provider=${pin.providerId ?? "*"} model=${pin.modelId ?? "*"} is not in the healthy catalog`,
    });
  }
  // Deterministic tiebreak: first alphabetical modelId under the pinned provider.
  candidates.sort((a, b) => a.modelId.localeCompare(b.modelId));
  const chosen = candidates[0]!;
  return { providerId: chosen.providerId, modelId: chosen.modelId };
}

/**
 * Resolve the governance decision (operator_rule > client_override > autopilot)
 * for a request. Thin wrapper over the core resolver so callers share a single
 * resolution point; callers own any event publishing that follows.
 */
export function resolveGovernance(input: ResolveRoutingDecisionInput): coreOverrides.OverrideResolution {
  return coreOverrides.resolveOverride({ request: input.request, rules: input.rules });
}

/**
 * Build the routing decision from an already-computed governance resolution.
 * Validates any resolved pin against the catalog snapshot and otherwise defers
 * to autonomous scoring via routing.decideRoute.
 *
 * This helper is pure with respect to side effects: it performs no provider
 * calls, no telemetry writes, no event-bus publishing, and no persistence.
 * Callers own those concerns.
 */
export function buildRoutingDecision(input: BuildRoutingDecisionInput): RoutingDecision {
  const { request, resolution, snapshot } = input;

  if (resolution.pin) {
    // Validate that the pin target exists in the healthy catalog before any provider call.
    const pin = resolution.pin as { providerId?: string | null; modelId?: string | null };
    const target = validatePinAgainstCatalog(
      { providerId: pin.providerId ?? null, modelId: pin.modelId ?? null },
      snapshot,
    );
    const rationale: RationaleEntry[] = [
      {
        factor: "override",
        verdict: "preferred",
        note:
          resolution.effectiveSource === "operator_rule"
            ? `autonomous scoring bypassed by operator_rule ${resolution.matchedRuleId ?? ""}${
                resolution.shadowedSource ? " (shadowed client_override)" : ""
              }`.trim()
            : "autonomous scoring bypassed by client_override",
      },
    ];
    // Price the pinned target with the same estimator autopilot uses, so budget
    // enforcement sees a real cost for override/operator-rule/pin decisions.
    // The target comes from the priced catalog snapshot, so it is always priceable.
    const outputTokens = Math.max(4, Math.floor(request.estimatedInputTokens / 4));
    const estimatedCostUsd = cost.estimateCostUsd({
      table: snapshot.pricingTable,
      providerId: target.providerId,
      modelId: target.modelId,
      inputTokens: request.estimatedInputTokens,
      outputTokens,
    });
    return {
      decisionSource: resolution.effectiveSource,
      shadowedSource: resolution.shadowedSource,
      candidateRanking: [
        {
          providerId: target.providerId,
          modelId: target.modelId,
          included: true,
          exclusionReason: null,
          scoreBreakdown: { override: 1 },
        },
      ],
      chosenProviderId: target.providerId,
      chosenModelId: target.modelId,
      rationale,
      pricingTableVersionId: snapshot.pricingTable.versionId,
      estimatedCostUsd,
    };
  }

  try {
    return routing.decideRoute({
      request,
      catalog: snapshot.models,
      pricingTable: snapshot.pricingTable,
    });
  } catch (err) {
    const message = (err as Error).message;
    if (/context/i.test(message)) {
      throw new LcaError({ httpStatus: 422, code: "context_exceeded", message });
    }
    if (/no candidate/i.test(message) || /empty catalog/i.test(message)) {
      throw new LcaError({
        httpStatus: 422,
        code: "provider_unavailable",
        message,
      });
    }
    throw err;
  }
}

/**
 * Shared routing-resolution logic used where governance resolution and decision
 * construction can happen together (e.g. read-only preview). Resolves the
 * governance decision once and builds the routing decision from it.
 *
 * This helper is pure with respect to side effects: it performs no provider
 * calls, no telemetry writes, no event-bus publishing, and no persistence.
 */
export function resolveRoutingDecision(input: ResolveRoutingDecisionInput): ResolvedRouting {
  const resolution = resolveGovernance(input);
  const decision = buildRoutingDecision({
    request: input.request,
    resolution,
    snapshot: input.snapshot,
  });
  return { decision, resolution };
}

