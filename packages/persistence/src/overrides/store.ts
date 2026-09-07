import { randomUUID } from "node:crypto";

import type { OperatorRule, OperatorRuleInput, RuleMatch, RulePin } from "@lca/core";

import type { Db } from "../db/schema.js";

export interface OperatorRuleStore {
  create(input: OperatorRuleInput): Promise<OperatorRule>;
  update(ruleId: string, patch: Partial<OperatorRuleInput>): Promise<OperatorRule | null>;
  remove(ruleId: string): Promise<boolean>;
  list(): Promise<OperatorRule[]>;
  /**
   * Returns a cached snapshot of all rules ordered by priority ascending.
   * The array is invalidated by any create/update/remove call.
   */
  snapshot(): Promise<readonly OperatorRule[]>;
  invalidate(): void;
}

interface Row {
  rule_id: string;
  priority: number;
  match: unknown;
  pin: unknown;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

function toRule(row: Row): OperatorRule {
  return {
    ruleId: row.rule_id,
    priority: row.priority,
    match: row.match as RuleMatch,
    pin: row.pin as RulePin,
    enabled: row.enabled,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function createOperatorRuleStore(db: Db): OperatorRuleStore {
  let cache: readonly OperatorRule[] | null = null;

  async function loadAll(): Promise<OperatorRule[]> {
    const rows = (await db
      .selectFrom("operator_rules")
      .selectAll()
      .orderBy("priority", "asc")
      .orderBy("rule_id", "asc")
      .execute()) as unknown as Row[];
    return rows.map(toRule);
  }

  return {
    async create(input) {
      const ruleId = `rule_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const now = new Date();
      const row = (await db
        .insertInto("operator_rules")
        .values({
          rule_id: ruleId,
          priority: input.priority,
          match: JSON.stringify(input.match),
          pin: JSON.stringify(input.pin),
          enabled: input.enabled,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow()) as unknown as Row;
      cache = null;
      return toRule(row);
    },
    async update(ruleId, patch) {
      const set: Record<string, unknown> = { updated_at: new Date() };
      if (typeof patch.priority === "number") set.priority = patch.priority;
      if (typeof patch.enabled === "boolean") set.enabled = patch.enabled;
      if (patch.match) set.match = JSON.stringify(patch.match);
      if (patch.pin) set.pin = JSON.stringify(patch.pin);
      const row = (await db
        .updateTable("operator_rules")
        .set(set)
        .where("rule_id", "=", ruleId)
        .returningAll()
        .executeTakeFirst()) as unknown as Row | undefined;
      cache = null;
      return row ? toRule(row) : null;
    },
    async remove(ruleId) {
      const result = await db
        .deleteFrom("operator_rules")
        .where("rule_id", "=", ruleId)
        .executeTakeFirst();
      cache = null;
      return Number(result.numDeletedRows ?? 0) > 0;
    },
    async list() {
      return loadAll();
    },
    async snapshot() {
      if (cache) return cache;
      const rules = await loadAll();
      cache = rules;
      return cache;
    },
    invalidate() {
      cache = null;
    },
  };
}
