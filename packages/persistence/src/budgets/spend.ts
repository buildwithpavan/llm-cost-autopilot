import { sql } from "kysely";

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
