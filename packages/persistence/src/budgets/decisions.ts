import type { budgets as coreBudgets } from "@lca/core";

import type { Db } from "../db/schema.js";

/** Durable budget decision audit record (warned/blocked only). Decimal as strings. */
export interface BudgetDecisionRecord {
  eventId: string;
  decidedAt: string;
  clientId: string;
  decision: "warned" | "blocked";
  requestEstimatedCostUsd: string;
  applicableBudgetIds: string[];
  blockedBudgetIds: string[];
  evaluations: coreBudgets.BudgetEvaluationResult[];
}

/**
 * Persist a budget decision audit record. Best-effort / idempotent per eventId;
 * NOT transactionally coupled to provider execution. A blocked record documents
 * a guardrail decision, not a provider call.
 */
export async function writeBudgetDecision(db: Db, rec: BudgetDecisionRecord): Promise<void> {
  await db
    .insertInto("budget_decisions")
    .values({
      event_id: rec.eventId,
      decided_at: rec.decidedAt,
      client_id: rec.clientId,
      decision: rec.decision,
      request_estimated_cost_usd: rec.requestEstimatedCostUsd,
      applicable_budget_ids: JSON.stringify(rec.applicableBudgetIds),
      blocked_budget_ids: JSON.stringify(rec.blockedBudgetIds),
      evaluations: JSON.stringify(rec.evaluations),
    })
    .onConflict((oc) => oc.column("event_id").doNothing())
    .execute();
}

export interface BudgetDecisionFilters {
  clientId?: string;
  since?: string;
  until?: string;
  limit?: number;
}

interface Row {
  event_id: string;
  decided_at: Date;
  client_id: string;
  decision: "warned" | "blocked";
  request_estimated_cost_usd: string;
  applicable_budget_ids: unknown;
  blocked_budget_ids: unknown;
  evaluations: unknown;
}

/** Read persisted budget decisions (most recent first). Operator-facing, like telemetry reads. */
export async function queryBudgetDecisions(
  db: Db,
  filters: BudgetDecisionFilters = {},
): Promise<BudgetDecisionRecord[]> {
  const limit = Number.isFinite(filters.limit) ? Math.max(1, Math.min(500, Math.floor(filters.limit as number))) : 100;
  let q = db.selectFrom("budget_decisions").selectAll();
  if (filters.clientId) q = q.where("client_id", "=", filters.clientId);
  if (filters.since) q = q.where("decided_at", ">=", new Date(filters.since));
  if (filters.until) q = q.where("decided_at", "<=", new Date(filters.until));
  const rows = (await q.orderBy("decided_at", "desc").limit(limit).execute()) as unknown as Row[];
  return rows.map((r) => ({
    eventId: r.event_id,
    decidedAt: r.decided_at.toISOString(),
    clientId: r.client_id,
    decision: r.decision,
    requestEstimatedCostUsd: r.request_estimated_cost_usd,
    applicableBudgetIds: r.applicable_budget_ids as string[],
    blockedBudgetIds: r.blocked_budget_ids as string[],
    evaluations: r.evaluations as BudgetDecisionRecord["evaluations"],
  }));
}

/** True when a budget decision exists for the given correlation/event id. */
export async function budgetDecisionExists(db: Db, eventId: string): Promise<boolean> {
  const row = await db
    .selectFrom("budget_decisions")
    .select("event_id")
    .where("event_id", "=", eventId)
    .executeTakeFirst();
  return !!row;
}
