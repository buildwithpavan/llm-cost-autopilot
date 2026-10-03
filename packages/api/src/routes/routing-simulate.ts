import { randomUUID } from "node:crypto";

import type { FastifyPluginAsync } from "fastify";

import {
  completionRequestSchema,
  cost,
  evaluation,
  operatorRuleInputSchema,
  overrides as coreOverrides,
  type NormalizedRequest,
  type OperatorRule,
} from "@lca/core";

import { loadCatalogSnapshot, type AppContext } from "../wiring.js";
import { resolveRoutingDecision, validatePinAgainstCatalog } from "../routing/resolve-decision.js";
import { evaluateRequestBudgets } from "../budgets/evaluate-request-budgets.js";
import { LcaError } from "../plugins/errors.js";

/** Synthetic, non-persisted rule id used only to trace the proposed rule within a simulation. */
const SIMULATION_RULE_ID = "__simulation__";

const plugin: FastifyPluginAsync<AppContext> = async (fastify, deps) => {
  fastify.post("/v1/routing/simulate", async (req, reply) => {
    const body = (req.body ?? {}) as { request?: unknown; proposedRule?: unknown };

    const parsedRequest = completionRequestSchema.safeParse(body.request);
    if (!parsedRequest.success) {
      throw new LcaError({
        httpStatus: 400,
        code: "invalid_request",
        message: "malformed request",
        details: { issues: parsedRequest.error.issues },
      });
    }
    const parsedRule = operatorRuleInputSchema.safeParse(body.proposedRule);
    if (!parsedRule.success) {
      throw new LcaError({
        httpStatus: 400,
        code: "invalid_request",
        message: "malformed proposedRule",
        details: { issues: parsedRule.error.issues },
      });
    }

    const clientId = (req as unknown as { lca: { clientId: string } }).lca.clientId;
    const normalized: NormalizedRequest = {
      requestId: randomUUID(),
      clientId,
      receivedAt: new Date().toISOString(),
      messages: parsedRequest.data.messages,
      requirements: {
        requiredCapabilities: parsedRequest.data.requirements?.requiredCapabilities ?? [],
        maxLatencyMs: parsedRequest.data.requirements?.maxLatencyMs ?? null,
        maxCostUsd: parsedRequest.data.requirements?.maxCostUsd ?? null,
        minQualityTier: parsedRequest.data.requirements?.minQualityTier ?? null,
      },
      override: parsedRequest.data.override ?? null,
      estimatedInputTokens: evaluation.estimateInputTokens(parsedRequest.data.messages),
    };

    const snapshot = await loadCatalogSnapshot(deps);

    // Reject an unpriceable/unavailable proposed target up front — same structured
    // override-target error as live governance, before any resolution.
    validatePinAgainstCatalog(parsedRule.data.pin, snapshot);

    // The proposed rule participates as an enabled operator rule ONLY in this
    // simulation: it is never persisted and the live snapshot is not mutated.
    const now = new Date().toISOString();
    const proposedRule: OperatorRule = {
      ...parsedRule.data,
      ruleId: SIMULATION_RULE_ID,
      createdAt: now,
      updatedAt: now,
    };

    const liveRules = (await deps.ruleStore?.snapshot()) ?? [];

    // Current (live) and proposed decisions via the same shared resolver/precedence
    // used by /v1/routing/preview and /v1/completions. A new array is built for the
    // proposed case; the cached live snapshot is never touched.
    const current = resolveRoutingDecision({ request: normalized, rules: liveRules, snapshot });
    const proposed = resolveRoutingDecision({
      request: normalized,
      rules: [...liveRules, proposedRule],
      snapshot,
    });

    // Read-only budget evaluation for each decision (never reserves or writes).
    const [currentBudget, proposedBudget] = await Promise.all([
      evaluateRequestBudgets({
        db: deps.db,
        budgetStore: deps.budgetStore,
        clientId,
        requestEstimatedCostUsd: current.decision.estimatedCostUsd,
      }),
      evaluateRequestBudgets({
        db: deps.db,
        budgetStore: deps.budgetStore,
        clientId,
        requestEstimatedCostUsd: proposed.decision.estimatedCostUsd,
      }),
    ]);

    const matchesRequest = coreOverrides.matchesRule(proposedRule, normalized);
    const effective =
      proposed.resolution.effectiveSource === "operator_rule" &&
      proposed.resolution.matchedRuleId === SIMULATION_RULE_ID;
    // Matched the request but a higher-precedence operator rule governs instead.
    const shadowedByRuleId =
      matchesRequest && !effective && proposed.resolution.effectiveSource === "operator_rule"
        ? proposed.resolution.matchedRuleId
        : null;

    const providerChanged = current.decision.chosenProviderId !== proposed.decision.chosenProviderId;
    const modelChanged = current.decision.chosenModelId !== proposed.decision.chosenModelId;

    return reply.status(200).send({
      current: { decision: current.decision, budget: currentBudget },
      proposed: { decision: proposed.decision, budget: proposedBudget },
      comparison: {
        decisionChanged: providerChanged || modelChanged,
        providerChanged,
        modelChanged,
        estimatedCostDeltaUsd: cost.subtractUsd(
          proposed.decision.estimatedCostUsd,
          current.decision.estimatedCostUsd,
        ),
        budgetOutcomeChanged: currentBudget.decision !== proposedBudget.decision,
      },
      proposal: {
        simulationRuleId: SIMULATION_RULE_ID,
        matchesRequest,
        effective,
        shadowedByRuleId,
      },
    });
  });
};

export default plugin;
