import type { FastifyPluginAsync } from "fastify";

import { budgets as coreBudgets, budgetInputSchema, type Budget, type BudgetInput } from "@lca/core";
import { spendForBudgets, type BudgetStore, type Db } from "@lca/persistence";

import { LcaError } from "../plugins/errors.js";

export interface BudgetsDeps {
  db: Db;
  budgetStore: BudgetStore;
}

interface BudgetStatusRow {
  budgetId: string;
  scope: Budget["scope"];
  clientId: string | null;
  period: Budget["period"];
  action: Budget["action"];
  limitUsd: string;
  currentSpendUsd: string;
  remainingUsd: string;
  utilization: string;
  status: coreBudgets.BudgetStatusLevel;
}

const plugin: FastifyPluginAsync<BudgetsDeps> = async (fastify, deps) => {
  fastify.get<{ Reply: Budget[] }>("/v1/budgets", async (_req, reply) => {
    return reply.status(200).send(await deps.budgetStore.list());
  });

  fastify.post<{ Body: BudgetInput; Reply: Budget }>("/v1/budgets", async (req, reply) => {
    const parsed = budgetInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new LcaError({
        httpStatus: 400,
        code: "invalid_request",
        message: "malformed budget",
        details: { issues: parsed.error.issues },
      });
    }
    const budget = await deps.budgetStore.create(parsed.data);
    return reply.status(201).send(budget);
  });

  // Static route registered before the parametric one so it is never shadowed.
  fastify.get("/v1/budgets/status", async (req, reply) => {
    const clientId = (req as unknown as { lca: { clientId: string } }).lca.clientId;
    const applicable = await deps.budgetStore.applicable(clientId);
    const spendByBudget = await spendForBudgets(deps.db, applicable);
    const rows: BudgetStatusRow[] = applicable.map((b) => {
      const currentSpendUsd = spendByBudget[b.budgetId] ?? "0";
      const s = coreBudgets.budgetStatus({ limitUsd: b.limitUsd, currentSpendUsd });
      return {
        budgetId: b.budgetId,
        scope: b.scope,
        clientId: b.clientId,
        period: b.period,
        action: b.action,
        limitUsd: b.limitUsd,
        currentSpendUsd,
        remainingUsd: s.remainingUsd,
        utilization: s.utilization,
        status: s.status,
      };
    });
    return reply.status(200).send({ budgets: rows });
  });

  fastify.get<{ Params: { id: string } }>("/v1/budgets/:id", async (req, reply) => {
    const budget = await deps.budgetStore.get(req.params.id);
    if (!budget) {
      throw new LcaError({
        httpStatus: 404,
        code: "budget_not_found",
        message: `no budget with id ${req.params.id}`,
      });
    }
    return reply.status(200).send(budget);
  });

  fastify.patch<{ Params: { id: string } }>("/v1/budgets/:id", async (req, reply) => {
    const { id } = req.params;
    const current = await deps.budgetStore.get(id);
    if (!current) {
      throw new LcaError({
        httpStatus: 404,
        code: "budget_not_found",
        message: `no budget with id ${id}`,
      });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    // Validate the fully-merged budget so cross-field invariants (scope/client,
    // limit > 0, enums) are enforced deterministically before persisting.
    const merged = {
      scope: "scope" in body ? body["scope"] : current.scope,
      clientId: "clientId" in body ? body["clientId"] : current.clientId,
      period: "period" in body ? body["period"] : current.period,
      limitUsd: "limitUsd" in body ? body["limitUsd"] : current.limitUsd,
      action: "action" in body ? body["action"] : current.action,
      enabled: "enabled" in body ? body["enabled"] : current.enabled,
    };
    const parsed = budgetInputSchema.safeParse(merged);
    if (!parsed.success) {
      throw new LcaError({
        httpStatus: 400,
        code: "invalid_request",
        message: "invalid budget patch",
        details: { issues: parsed.error.issues },
      });
    }
    const patch: Partial<BudgetInput> = {};
    if ("scope" in body) patch.scope = parsed.data.scope;
    if ("clientId" in body) patch.clientId = parsed.data.clientId;
    if ("period" in body) patch.period = parsed.data.period;
    if ("limitUsd" in body) patch.limitUsd = parsed.data.limitUsd;
    if ("action" in body) patch.action = parsed.data.action;
    if ("enabled" in body) patch.enabled = parsed.data.enabled;
    const updated = await deps.budgetStore.update(id, patch);
    if (!updated) {
      throw new LcaError({
        httpStatus: 404,
        code: "budget_not_found",
        message: `no budget with id ${id}`,
      });
    }
    return reply.status(200).send(updated);
  });

  fastify.delete<{ Params: { id: string } }>("/v1/budgets/:id", async (req, reply) => {
    const removed = await deps.budgetStore.remove(req.params.id);
    if (!removed) {
      throw new LcaError({
        httpStatus: 404,
        code: "budget_not_found",
        message: `no budget with id ${req.params.id}`,
      });
    }
    return reply.status(204).send();
  });
};

export default plugin;
