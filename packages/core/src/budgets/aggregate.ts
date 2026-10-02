import { Decimal } from "../cost/decimal.js";
import type { Budget, BudgetAction, BudgetPeriod, BudgetScope } from "../types/budget.js";
import { evaluateBudget, type BudgetDecision } from "./evaluate.js";

export type BudgetAggregateDecision = "no_budget" | "allowed" | "warned" | "blocked";

export interface BudgetEvaluationResult {
  budgetId: string;
  scope: BudgetScope;
  clientId: string | null;
  period: BudgetPeriod;
  action: BudgetAction;
  decision: BudgetDecision;
  currentSpendUsd: string;
  requestEstimatedCostUsd: string;
  projectedSpendUsd: string;
  limitUsd: string;
  remainingUsd: string;
  overBudget: boolean;
}

export interface EvaluateBudgetsInput {
  budgets: readonly Budget[];
  /** budgetId → current spend in that budget's window, as a decimal USD string. */
  spendByBudget: Readonly<Record<string, string>>;
  /** Exact estimated cost of the routing decision that would execute. */
  requestEstimatedCostUsd: string;
}

export interface BudgetAggregateResult {
  decision: BudgetAggregateDecision;
  requestEstimatedCostUsd: string;
  /** IDs of budgets whose action blocked the request (empty unless blocked). */
  blockedBudgetIds: string[];
  /** Every applicable budget's result, deterministically ordered. */
  evaluations: BudgetEvaluationResult[];
}

const DECISION_RANK: Record<BudgetDecision, number> = { block: 0, warn: 1, allow: 2 };

/**
 * Evaluate every applicable budget for a request using the per-budget
 * evaluateBudget primitive, then combine deterministically:
 *   any block → blocked; else any warn → warned; else allowed; none → no_budget.
 * All per-budget results are retained. Pure; no side effects or SQL.
 */
export function evaluateBudgets(input: EvaluateBudgetsInput): BudgetAggregateResult {
  const evaluations: BudgetEvaluationResult[] = input.budgets.map((b) => {
    const currentSpendUsd = input.spendByBudget[b.budgetId] ?? "0";
    const e = evaluateBudget({
      currentSpendUsd,
      requestEstimatedCostUsd: input.requestEstimatedCostUsd,
      limitUsd: b.limitUsd,
      action: b.action,
    });
    return {
      budgetId: b.budgetId,
      scope: b.scope,
      clientId: b.clientId,
      period: b.period,
      action: b.action,
      decision: e.decision,
      currentSpendUsd: e.currentSpendUsd,
      requestEstimatedCostUsd: e.requestEstimatedCostUsd,
      projectedSpendUsd: e.projectedSpendUsd,
      limitUsd: e.limitUsd,
      remainingUsd: e.remainingUsd,
      overBudget: e.overBudget,
    };
  });

  // Deterministic order: block before warn before allow, then least remaining
  // headroom first, then budgetId ascending.
  evaluations.sort(
    (a, b) =>
      DECISION_RANK[a.decision] - DECISION_RANK[b.decision] ||
      (new Decimal(a.remainingUsd).lt(b.remainingUsd)
        ? -1
        : new Decimal(a.remainingUsd).gt(b.remainingUsd)
          ? 1
          : 0) ||
      a.budgetId.localeCompare(b.budgetId),
  );

  let decision: BudgetAggregateDecision;
  if (evaluations.length === 0) decision = "no_budget";
  else if (evaluations.some((e) => e.decision === "block")) decision = "blocked";
  else if (evaluations.some((e) => e.decision === "warn")) decision = "warned";
  else decision = "allowed";

  const blockedBudgetIds = evaluations
    .filter((e) => e.decision === "block")
    .map((e) => e.budgetId);

  return {
    decision,
    requestEstimatedCostUsd: input.requestEstimatedCostUsd,
    blockedBudgetIds,
    evaluations,
  };
}
