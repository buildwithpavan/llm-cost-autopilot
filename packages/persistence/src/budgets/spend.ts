import { sql } from "kysely";

import { budgets as coreBudgets, type Budget } from "@lca/core";

import type { Db } from "../db/schema.js";

export interface SpendQuery {
  since: string;
  until: string;
  /** When provided, restrict to this client; otherwise aggregate all clients. */
  clientId?: string | null;
}

/**
 * Exact sum of estimated_cost_usd over the window, as a decimal USD string.
 * Spend basis is estimatedCostUsd (available immediately; actual lags
 * reconciliation). Aggregated in PostgreSQL — not subject to any event cap.
 */
export async function sumEstimatedSpend(db: Db, q: SpendQuery): Promise<string> {
  let query = db
    .selectFrom("telemetry_events")
    .where("received_at", ">=", new Date(q.since))
    .where("received_at", "<=", new Date(q.until));
  if (q.clientId) query = query.where("client_id", "=", q.clientId);
  const row = (await query
    .select(sql<string>`COALESCE(SUM(estimated_cost_usd), 0)::text`.as("spend"))
    .executeTakeFirstOrThrow()) as unknown as { spend: string };
  return row.spend;
}

/**
 * Current spend for each budget, keyed by budgetId. Budgets that resolve to the
 * same window + scope + client share a single aggregate query (no N+1 across
 * budgets that overlap). Spend basis is estimatedCostUsd.
 */
export async function spendForBudgets(
  db: Db,
  budgets: readonly Budget[],
  now: Date = new Date(),
): Promise<Record<string, string>> {
  interface Group {
    since: string;
    until: string;
    clientId: string | null;
    budgetIds: string[];
  }
  const groups = new Map<string, Group>();
  for (const b of budgets) {
    const w = coreBudgets.budgetWindow(b.period, now);
    const clientId = b.scope === "client" ? b.clientId : null;
    const key = `${b.period}|${b.scope}|${clientId ?? ""}`;
    let g = groups.get(key);
    if (!g) {
      g = { since: w.since, until: w.until, clientId, budgetIds: [] };
      groups.set(key, g);
    }
    g.budgetIds.push(b.budgetId);
  }

  const out: Record<string, string> = {};
  for (const g of groups.values()) {
    const spend = await sumEstimatedSpend(db, {
      since: g.since,
      until: g.until,
      ...(g.clientId ? { clientId: g.clientId } : {}),
    });
    for (const id of g.budgetIds) out[id] = spend;
  }
  return out;
}

