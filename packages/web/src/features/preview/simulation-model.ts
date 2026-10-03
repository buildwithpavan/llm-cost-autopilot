import { formatUsd } from "../../lib/format.js";
import type { DecisionSource } from "../../types/index.js";
import type {
  SimulationBudgetDecision,
  SimulationResponse,
} from "../../lib/api/simulate.js";

export const BUDGET_LABEL: Record<SimulationBudgetDecision, string> = {
  no_budget: "No budget",
  allowed: "Allowed",
  warned: "Warned",
  blocked: "Blocked",
};

export type BudgetTone = "neutral" | "success" | "warn" | "error";

export const BUDGET_TONE: Record<SimulationBudgetDecision, BudgetTone> = {
  no_budget: "neutral",
  allowed: "success",
  warned: "warn",
  blocked: "error",
};

export interface SimulationSideView {
  source: DecisionSource;
  provider: string;
  model: string;
  /** Raw exact decimal string (never floated). */
  estimatedCostUsd: string;
  estimatedDisplay: string;
  budgetDecision: SimulationBudgetDecision;
  budgetLabel: string;
  budgetTone: BudgetTone;
}

export type DeltaSign = "up" | "down" | "none";

export interface SimulationView {
  current: SimulationSideView;
  proposed: SimulationSideView;
  decisionChanged: boolean;
  providerChanged: boolean;
  modelChanged: boolean;
  budgetOutcomeChanged: boolean;
  /** Raw signed decimal string (proposed − current). */
  estimatedCostDeltaUsd: string;
  costDeltaDisplay: string;
  costDeltaSign: DeltaSign;
  proposalSummary: string;
  matchesRequest: boolean;
  effective: boolean;
  shadowedByRuleId: string | null;
}

function side(s: SimulationResponse["current"]): SimulationSideView {
  return {
    source: s.decision.decisionSource,
    provider: s.decision.chosenProviderId,
    model: s.decision.chosenModelId,
    estimatedCostUsd: s.decision.estimatedCostUsd,
    estimatedDisplay: formatUsd(s.decision.estimatedCostUsd),
    budgetDecision: s.budget.decision,
    budgetLabel: BUDGET_LABEL[s.budget.decision],
    budgetTone: BUDGET_TONE[s.budget.decision],
  };
}

/** Sign of a signed decimal string without floating-point arithmetic. */
function deltaSign(raw: string): DeltaSign {
  const t = raw.trim();
  if (t.startsWith("-")) return "down";
  if (/^0(\.0+)?$/.test(t)) return "none";
  return "up";
}

function proposalSummary(res: SimulationResponse): string {
  const p = res.proposal;
  if (!p.matchesRequest) return "The proposed rule does not match this request.";
  if (p.effective) return "The proposed rule matches and governs this request.";
  if (p.shadowedByRuleId) return `The proposed rule matches but is shadowed by rule ${p.shadowedByRuleId}.`;
  return "The proposed rule matches this request.";
}

export function presentSimulation(res: SimulationResponse): SimulationView {
  const sign = deltaSign(res.comparison.estimatedCostDeltaUsd);
  const abs = res.comparison.estimatedCostDeltaUsd.replace(/^-/, "");
  return {
    current: side(res.current),
    proposed: side(res.proposed),
    decisionChanged: res.comparison.decisionChanged,
    providerChanged: res.comparison.providerChanged,
    modelChanged: res.comparison.modelChanged,
    budgetOutcomeChanged: res.comparison.budgetOutcomeChanged,
    estimatedCostDeltaUsd: res.comparison.estimatedCostDeltaUsd,
    costDeltaDisplay: sign === "none" ? formatUsd("0") : `${sign === "up" ? "+" : "−"}${formatUsd(abs)}`,
    costDeltaSign: sign,
    proposalSummary: proposalSummary(res),
    matchesRequest: res.proposal.matchesRequest,
    effective: res.proposal.effective,
    shadowedByRuleId: res.proposal.shadowedByRuleId,
  };
}
