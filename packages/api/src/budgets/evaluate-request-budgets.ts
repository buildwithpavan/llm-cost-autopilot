import { budgets as coreBudgets } from "@lca/core";
import { spendForBudgets, type BudgetStore, type Db } from "@lca/persistence";

export interface EvaluateRequestBudgetsArgs {
  db: Db;
  budgetStore?: BudgetStore | undefined;
  clientId: string;
  /** Exact estimated cost of the routing decision that would execute. */
  requestEstimatedCostUsd: string;
  now?: Date;
}

const NO_BUDGET = (requestEstimatedCostUsd: string): coreBudgets.BudgetAggregateResult => ({
  decision: "no_budget",
  requestEstimatedCostUsd,
  blockedBudgetIds: [],
  evaluations: [],
});

/**
 * Shared budget evaluation used by both completion enforcement and preview
 * simulation. Pure read path: loads applicable budgets, reads their windowed
 * spend, and combines via the core evaluator. Never mutates budget state.
 */
export async function evaluateRequestBudgets(
  args: EvaluateRequestBudgetsArgs,
): Promise<coreBudgets.BudgetAggregateResult> {
  if (!args.budgetStore) return NO_BUDGET(args.requestEstimatedCostUsd);
  const applicable = await args.budgetStore.applicable(args.clientId);
  if (applicable.length === 0) return NO_BUDGET(args.requestEstimatedCostUsd);
  const spendByBudget = await spendForBudgets(args.db, applicable, args.now);
  return coreBudgets.evaluateBudgets({
    budgets: applicable,
    spendByBudget,
    requestEstimatedCostUsd: args.requestEstimatedCostUsd,
  });
}
