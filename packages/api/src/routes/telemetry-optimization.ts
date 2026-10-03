import type { FastifyPluginAsync } from "fastify";

import { budgets as coreBudgets, insights as coreInsights } from "@lca/core";
import { aggregateRecentTelemetry, spendForBudgets, type QueryFilters } from "@lca/persistence";

import { loadCatalogSnapshot, type AppContext } from "../wiring.js";
import { LcaError } from "../plugins/errors.js";

/** Maximum supported window, aligned with the 30-day full-fidelity retention boundary. */
const MAX_WINDOW_DAYS = 30;
const MAX_WINDOW_MS = MAX_WINDOW_DAYS * 86_400_000;

export interface OptimizationDeps extends AppContext {
  optimizationConfig: coreInsights.OptimizationConfig;
}

function parseDate(value: string, field: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new LcaError({
      httpStatus: 400,
      code: "invalid_request",
      message: `invalid ${field}: expected an ISO-8601 timestamp`,
    });
  }
  return d;
}

const plugin: FastifyPluginAsync<OptimizationDeps> = async (fastify, deps) => {
  fastify.get("/v1/telemetry/optimization-insights", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;

    const until = q["until"] ? parseDate(q["until"], "until") : new Date();
    const since = q["since"]
      ? parseDate(q["since"], "since")
      : new Date(until.getTime() - MAX_WINDOW_MS);

    if (since.getTime() >= until.getTime()) {
      throw new LcaError({
        httpStatus: 400,
        code: "invalid_request",
        message: "invalid range: since must be strictly before until",
      });
    }
    if (until.getTime() - since.getTime() > MAX_WINDOW_MS) {
      throw new LcaError({
        httpStatus: 400,
        code: "invalid_request",
        message: `requested window exceeds the maximum of ${MAX_WINDOW_DAYS} days`,
        details: { maxWindowDays: MAX_WINDOW_DAYS },
      });
    }

    const filters: QueryFilters = {
      since: since.toISOString(),
      until: until.toISOString(),
    };
    if (q["clientId"]) filters.clientId = q["clientId"];
    if (q["providerId"]) filters.providerId = q["providerId"];
    if (q["modelId"]) filters.modelId = q["modelId"];

    // Budget pressure mirrors GET /v1/budgets/status semantics: scoped to the
    // authenticated client (its applicable global + client budgets).
    const clientId = (req as unknown as { lca: { clientId: string } }).lca.clientId;

    const [summary, snapshot, budgetStatuses] = await Promise.all([
      aggregateRecentTelemetry(deps.db, filters),
      loadCatalogSnapshot(deps),
      loadBudgetStatuses(deps, clientId),
    ]);

    const insightList = coreInsights.generateOptimizationInsights({
      totalEstimatedCostUsd: summary.totals.estimatedCostUsd,
      byModel: summary.byModel.map((m) => ({
        providerId: m.providerId,
        modelId: m.modelId,
        requestCount: m.requestCount,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        estimatedCostUsd: m.estimatedCostUsd,
      })),
      catalog: snapshot.models,
      pricingTable: snapshot.pricingTable,
      budgets: budgetStatuses,
      config: deps.optimizationConfig,
    });

    return reply.status(200).send({
      window: { since: filters.since, until: filters.until },
      thresholds: deps.optimizationConfig,
      pricingTableVersionId: snapshot.pricingTable.versionId,
      insights: insightList,
    });
  });
};

async function loadBudgetStatuses(
  deps: OptimizationDeps,
  clientId: string,
): Promise<coreInsights.OptimizationBudgetStatus[]> {
  if (!deps.budgetStore) return [];
  const applicable = await deps.budgetStore.applicable(clientId);
  const spendByBudget = await spendForBudgets(deps.db, applicable);
  return applicable.map((b) => {
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
}

export default plugin;
