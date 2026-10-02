import { randomUUID } from "node:crypto";

import {
  budgets as coreBudgets,
  budgetInputSchema,
  limitUsdSchema,
  type Budget,
  type BudgetInput,
} from "@lca/core";

import { sumEstimatedSpend } from "./spend.js";
import type { Db, SpendBudgetsRow } from "../db/schema.js";

export interface BudgetStore {
  create(input: BudgetInput): Promise<Budget>;
  update(budgetId: string, patch: Partial<BudgetInput>): Promise<Budget | null>;
  remove(budgetId: string): Promise<boolean>;
  get(budgetId: string): Promise<Budget | null>;
  list(): Promise<Budget[]>;
  /** Cached snapshot of all budgets (deterministic order). Invalidated on mutation. */
  snapshot(): Promise<readonly Budget[]>;
  /**
   * Enabled budgets that apply to a request: all enabled global budgets, plus
   * enabled client budgets matching `clientId`. When `clientId` is absent, only
   * global budgets apply. Global budgets are ordered before client budgets.
   */
  applicable(clientId?: string | null): Promise<readonly Budget[]>;
  /** Current spend in the budget's window (estimatedCostUsd basis), as a decimal string. */
  currentSpendUsd(budget: Budget, now?: Date): Promise<string>;
  invalidate(): void;
}

type Row = SpendBudgetsRow & {
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
};

function toBudget(row: Row): Budget {
  return {
    budgetId: row.budget_id,
    scope: row.scope,
    clientId: row.client_id,
    period: row.period,
    limitUsd: row.limit_usd,
    action: row.action,
    enabled: row.enabled,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function createBudgetStore(db: Db): BudgetStore {
  let cache: readonly Budget[] | null = null;

  // Deterministic order: global budgets first, then by client, then by id.
  async function loadAll(): Promise<Budget[]> {
    const rows = (await db
      .selectFrom("spend_budgets")
      .selectAll()
      .orderBy("scope", "asc")
      .orderBy("client_id", "asc")
      .orderBy("budget_id", "asc")
      .execute()) as unknown as Row[];
    // scope asc puts 'client' before 'global' alphabetically; force global first.
    return rows
      .map(toBudget)
      .sort(
        (a, b) =>
          (a.scope === "global" ? 0 : 1) - (b.scope === "global" ? 0 : 1) ||
          (a.clientId ?? "").localeCompare(b.clientId ?? "") ||
          a.budgetId.localeCompare(b.budgetId),
      );
  }

  async function snapshot(): Promise<readonly Budget[]> {
    if (cache) return cache;
    cache = await loadAll();
    return cache;
  }

  return {
    async create(input) {
      const parsed = budgetInputSchema.parse(input);
      const budgetId = `budget_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const now = new Date();
      const row = (await db
        .insertInto("spend_budgets")
        .values({
          budget_id: budgetId,
          scope: parsed.scope,
          client_id: parsed.clientId,
          period: parsed.period,
          limit_usd: parsed.limitUsd,
          action: parsed.action,
          enabled: parsed.enabled,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow()) as unknown as Row;
      cache = null;
      return toBudget(row);
    },

    async update(budgetId, patch) {
      const set: Record<string, unknown> = { updated_at: new Date() };
      if (patch.scope !== undefined) set.scope = patch.scope;
      if (patch.clientId !== undefined) set.client_id = patch.clientId;
      if (patch.period !== undefined) set.period = patch.period;
      if (patch.limitUsd !== undefined) set.limit_usd = limitUsdSchema.parse(patch.limitUsd);
      if (patch.action !== undefined) set.action = patch.action;
      if (patch.enabled !== undefined) set.enabled = patch.enabled;
      const row = (await db
        .updateTable("spend_budgets")
        .set(set)
        .where("budget_id", "=", budgetId)
        .returningAll()
        .executeTakeFirst()) as unknown as Row | undefined;
      cache = null;
      return row ? toBudget(row) : null;
    },

    async remove(budgetId) {
      const result = await db
        .deleteFrom("spend_budgets")
        .where("budget_id", "=", budgetId)
        .executeTakeFirst();
      cache = null;
      return Number(result.numDeletedRows ?? 0) > 0;
    },

    async get(budgetId) {
      const row = (await db
        .selectFrom("spend_budgets")
        .selectAll()
        .where("budget_id", "=", budgetId)
        .executeTakeFirst()) as unknown as Row | undefined;
      return row ? toBudget(row) : null;
    },

    async list() {
      return loadAll();
    },

    snapshot,

    async applicable(clientId) {
      const all = await snapshot();
      return all.filter(
        (b) =>
          b.enabled &&
          (b.scope === "global" || (!!clientId && b.scope === "client" && b.clientId === clientId)),
      );
    },

    async currentSpendUsd(budget, now = new Date()) {
      const window = coreBudgets.budgetWindow(budget.period, now);
      return sumEstimatedSpend(db, {
        since: window.since,
        until: window.until,
        ...(budget.scope === "client" ? { clientId: budget.clientId } : {}),
      });
    },

    invalidate() {
      cache = null;
    },
  };
}
