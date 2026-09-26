import type { RoutingDecision } from "../../types/index.js";
import type { ReplayResult } from "../../lib/api/replay.js";

/** How the backend produced the replayed decision. */
export type ReplayKind = "passthrough" | "scored" | "error";

export interface RouteIdentity {
  providerId: string;
  modelId: string;
}

export interface ReplayComparison {
  recorded: RoutingDecision;
  replayed: RoutingDecision | null;
  matches: boolean;
  /** True when a replayed decision exists and differs from the recorded one. */
  drift: boolean;
  kind: ReplayKind;
  replayError: string | null;
}

/**
 * Presentation-only view of the backend replay result. Never rescoring, matching,
 * or reconstructing decisions — it reads the backend's recorded/replayed/matches.
 */
export function deriveReplayComparison(result: ReplayResult): ReplayComparison {
  const replayed = result.replayed ?? null;
  const replayError = result.replayError ?? null;

  let kind: ReplayKind;
  if (replayed === null) {
    kind = "error";
  } else if (
    result.recorded.decisionSource === "operator_rule" ||
    result.recorded.decisionSource === "client_override"
  ) {
    kind = "passthrough";
  } else {
    kind = "scored";
  }

  // Drift is only meaningful when the backend returned a replayed decision.
  const drift = replayed !== null && result.matches === false;

  return { recorded: result.recorded, replayed, matches: result.matches, drift, kind, replayError };
}

/** Chosen route identity from a decision, or null when the decision is absent. */
export function routeIdentity(
  decision: Pick<RoutingDecision, "chosenProviderId" | "chosenModelId"> | null | undefined,
): RouteIdentity | null {
  if (!decision) return null;
  const providerId = decision.chosenProviderId;
  const modelId = decision.chosenModelId;
  if (typeof providerId !== "string" || typeof modelId !== "string") return null;
  return { providerId, modelId };
}

/** Formats a route as `provider:model`, or a neutral placeholder when absent (never fabricated). */
export function formatRoute(
  decision: Pick<RoutingDecision, "chosenProviderId" | "chosenModelId"> | null | undefined,
): string {
  const r = routeIdentity(decision);
  return r ? `${r.providerId}:${r.modelId}` : "—";
}
