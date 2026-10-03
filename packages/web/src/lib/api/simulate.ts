import type { OperatorRuleInput, RoutingDecision } from "../../types/index.js";
import { apiRequest } from "./client.js";
import type { RoutingPreviewRequest } from "./preview.js";

export type SimulationBudgetDecision = "no_budget" | "allowed" | "warned" | "blocked";

export interface SimulationBudget {
  decision: SimulationBudgetDecision;
  /** Exact decimal string. */
  requestEstimatedCostUsd: string;
  blockedBudgetIds: string[];
}

export interface SimulationSide {
  decision: RoutingDecision;
  budget: SimulationBudget;
}

export interface SimulationComparison {
  decisionChanged: boolean;
  providerChanged: boolean;
  modelChanged: boolean;
  /** proposed − current, exact decimal string (may be negative). */
  estimatedCostDeltaUsd: string;
  budgetOutcomeChanged: boolean;
}

export interface SimulationProposal {
  simulationRuleId: string;
  matchesRequest: boolean;
  effective: boolean;
  shadowedByRuleId: string | null;
}

export interface SimulationResponse {
  current: SimulationSide;
  proposed: SimulationSide;
  comparison: SimulationComparison;
  proposal: SimulationProposal;
}

export interface SimulateRoutingBody {
  request: RoutingPreviewRequest;
  proposedRule: OperatorRuleInput;
}

/**
 * POST /v1/routing/simulate — governance dry-run. Side-effect free: no rule is
 * persisted, no provider executes, no budget is reserved, no telemetry is
 * written. Monetary values are decimal strings and are never floated here.
 */
export function postRoutingSimulation(
  body: SimulateRoutingBody,
  opts: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<SimulationResponse> {
  const reqOpts: { method: "POST"; body: SimulateRoutingBody; apiKey?: string; signal?: AbortSignal } = {
    method: "POST",
    body,
  };
  if (opts.apiKey) reqOpts.apiKey = opts.apiKey;
  if (opts.signal) reqOpts.signal = opts.signal;
  return apiRequest<SimulationResponse>("/v1/routing/simulate", reqOpts);
}
