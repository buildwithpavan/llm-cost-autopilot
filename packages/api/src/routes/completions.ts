import { randomUUID } from "node:crypto";

import type { FastifyPluginAsync, FastifyRequest } from "fastify";

import {
  completionRequestSchema,
  evaluation,
  redaction,
  routing,
  telemetry as coreTelemetry,
  type CompletionRequest,
  type NormalizedRequest,
  type NormalizedResponse,
  type RoutingDecision,
} from "@lca/core";
import { writeBudgetDecision, type OperatorRuleStore, type TelemetryWriter } from "@lca/persistence";

import { loadCatalogSnapshot, type AppContext } from "../wiring.js";
import { buildRoutingDecision, resolveGovernance } from "../routing/resolve-decision.js";
import { evaluateRequestBudgets } from "../budgets/evaluate-request-budgets.js";
import { LcaError } from "../plugins/errors.js";
import { sharedStreamBus, type TelemetryStreamBus } from "../plugins/stream-bus.js";

export interface CompletionsDeps extends AppContext {
  telemetryWriter: TelemetryWriter;
  ruleStore?: OperatorRuleStore;
  streamBus?: TelemetryStreamBus;
}

interface CompletionResponseBody extends NormalizedResponse {
  decision: RoutingDecision;
}

function normalize(raw: CompletionRequest, req: FastifyRequest): NormalizedRequest {
  const requestId = String(req.id);
  const clientId = (req as unknown as { lca: { clientId: string } }).lca.clientId;
  const receivedAt = new Date().toISOString();
  const estimatedInputTokens = evaluation.estimateInputTokens(raw.messages);
  return {
    requestId,
    clientId,
    receivedAt,
    messages: raw.messages,
    requirements: {
      requiredCapabilities: raw.requirements?.requiredCapabilities ?? [],
      maxLatencyMs: raw.requirements?.maxLatencyMs ?? null,
      maxCostUsd: raw.requirements?.maxCostUsd ?? null,
      minQualityTier: raw.requirements?.minQualityTier ?? null,
    },
    override: raw.override ?? null,
    estimatedInputTokens,
  };
}

function makeEventId(requestId: string): string {
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRe.test(requestId) ? requestId : randomUUID();
}

const plugin: FastifyPluginAsync<CompletionsDeps> = async (fastify, deps) => {
  const bus = deps.streamBus ?? sharedStreamBus;

  fastify.post("/v1/completions", async (req, reply) => {
    const parsed = completionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new LcaError({
        httpStatus: 400,
        code: "invalid_request",
        message: "malformed completion request",
        details: { issues: parsed.error.issues },
      });
    }

    const normalized = normalize(parsed.data, req);
    const eventId = makeEventId(normalized.requestId);

    bus.publish({
      eventType: "request.received",
      eventId,
      clientId: normalized.clientId,
      timestamp: normalized.receivedAt,
      estimatedInputTokens: normalized.estimatedInputTokens,
      requiredCapabilities: normalized.requirements.requiredCapabilities,
    });

    const snapshot = await loadCatalogSnapshot(deps);

    // Resolve governance precedence (operator_rule > client_override > autopilot)
    // exactly once, publish the outcome, then build the routing decision. The
    // governance.completed event is published before any invalid-target 422 so
    // event/SSE ordering matches the completion contract. Side effects
    // (telemetry, provider calls, fallback) stay in this route.
    const rules = deps.ruleStore ? await deps.ruleStore.snapshot() : [];
    const resolution = resolveGovernance({ request: normalized, rules, snapshot });

    bus.publish({
      eventType: "governance.completed",
      eventId,
      clientId: normalized.clientId,
      timestamp: new Date().toISOString(),
      decisionSource: resolution.effectiveSource,
      shadowedSource: resolution.shadowedSource,
      matchedRuleId: resolution.matchedRuleId ?? null,
    });

    const decision = buildRoutingDecision({ request: normalized, resolution, snapshot });

    // Budget guardrail: evaluated after the routing decision (whose estimated
    // cost is the enforcement basis) and before any provider invocation. Soft
    // guardrail — spend is read from asynchronously-persisted telemetry.
    const budgetResult = await evaluateRequestBudgets({
      db: deps.db,
      budgetStore: deps.budgetStore,
      clientId: normalized.clientId,
      requestEstimatedCostUsd: decision.estimatedCostUsd,
    });

    // Durable + live audit for applied budget outcomes (warned/blocked only).
    // A blocked decision is a guardrail record, NOT a provider execution.
    if (budgetResult.decision === "warned" || budgetResult.decision === "blocked") {
      const auditTs = new Date().toISOString();
      const applicableBudgetIds = budgetResult.evaluations.map((e) => e.budgetId);
      // Best-effort, idempotent per eventId; not coupled to provider execution.
      await writeBudgetDecision(deps.db, {
        eventId,
        decidedAt: auditTs,
        clientId: normalized.clientId,
        decision: budgetResult.decision,
        requestEstimatedCostUsd: budgetResult.requestEstimatedCostUsd,
        applicableBudgetIds,
        blockedBudgetIds: budgetResult.blockedBudgetIds,
        evaluations: budgetResult.evaluations,
      }).catch((err: unknown) => {
        req.log.error({ err }, "budget decision audit write failed");
      });
      bus.publish({
        eventType: "budget.evaluated",
        eventId,
        clientId: normalized.clientId,
        timestamp: auditTs,
        decision: budgetResult.decision,
        requestEstimatedCostUsd: budgetResult.requestEstimatedCostUsd,
        applicableBudgetIds,
        blockedBudgetIds: budgetResult.blockedBudgetIds,
        evaluations: budgetResult.evaluations,
      });
    }

    if (budgetResult.decision === "blocked") {
      req.log.warn(
        {
          budget: {
            decision: budgetResult.decision,
            blockedBudgetIds: budgetResult.blockedBudgetIds,
            requestEstimatedCostUsd: budgetResult.requestEstimatedCostUsd,
          },
        },
        "budget_exceeded",
      );
      throw new LcaError({
        httpStatus: 429,
        code: "budget_exceeded",
        message: `request blocked by budget ${budgetResult.blockedBudgetIds.join(", ")}`,
        details: {
          blockedBudgetIds: budgetResult.blockedBudgetIds,
          requestEstimatedCostUsd: budgetResult.requestEstimatedCostUsd,
          budgets: budgetResult.evaluations
            .filter((e) => e.decision === "block")
            .map((e) => ({
              budgetId: e.budgetId,
              projectedSpendUsd: e.projectedSpendUsd,
              limitUsd: e.limitUsd,
            })),
        },
      });
    }
    if (budgetResult.decision === "warned") {
      const warned = budgetResult.evaluations.filter((e) => e.decision === "warn");
      decision.rationale.push({
        factor: "budget",
        verdict: "neutral",
        note: `budget warn (soft guardrail): projected ${warned[0]?.projectedSpendUsd ?? "?"} USD reaches/exceeds limit for budget(s) ${warned
          .map((e) => e.budgetId)
          .join(", ")}`,
      });
    }

    const adapter = deps.registry.get(decision.chosenProviderId);
    if (!adapter) {
      throw new LcaError({
        httpStatus: 502,
        code: "provider_unavailable",
        message: `provider ${decision.chosenProviderId} is not registered`,
      });
    }

    bus.publish({
      eventType: "decision.committed",
      eventId,
      clientId: normalized.clientId,
      timestamp: new Date().toISOString(),
      decision,
    });
    for (const candidate of decision.candidateRanking) {
      if (candidate.included) {
        bus.publish({
          eventType: "candidate.evaluated",
          eventId,
          clientId: normalized.clientId,
          timestamp: new Date().toISOString(),
          candidate,
        });
      } else {
        bus.publish({
          eventType: "candidate.excluded",
          eventId,
          clientId: normalized.clientId,
          timestamp: new Date().toISOString(),
          candidate,
        });
      }
    }

    const requestStart = Date.now();
    const controller = new AbortController();
    const fallbackOutcome = await routing.executeWithFallback({
      request: normalized,
      decision,
      pricingTable: snapshot.pricingTable,
      execute: async ({ providerId, modelId, attemptIndex }) => {
        bus.publish({
          eventType: "execution.started",
          eventId,
          clientId: normalized.clientId,
          timestamp: new Date().toISOString(),
          attemptIndex,
          providerId,
          modelId,
        });
        const targetAdapter = deps.registry.get(providerId);
        if (!targetAdapter) {
          const now = new Date().toISOString();
          const failedAttempt = {
            attemptIndex,
            providerId,
            modelId,
            startedAt: now,
            endedAt: now,
            latencyMs: 0,
            inputTokens: null,
            outputTokens: null,
            errorClass: "provider_unavailable" as const,
            estimatedCostUsd: "0",
            actualCostUsd: null,
            pricingTableVersionId: snapshot.pricingTable.versionId,
          };
          bus.publish({
            eventType: "execution.completed",
            eventId,
            clientId: normalized.clientId,
            timestamp: new Date().toISOString(),
            attempt: failedAttempt,
          });
          return {
            kind: "failure" as const,
            attempt: failedAttempt,
          };
        }
        const outcome = await targetAdapter.execute(
          {
            request: normalized,
            modelId,
            pricingTable: snapshot.pricingTable,
            deadlineAt: new Date(Date.now() + 30_000).toISOString(),
          },
          controller.signal,
        );
        if (outcome.kind === "success") {
          const attempt = { ...outcome.attempt, attemptIndex };
          bus.publish({
            eventType: "execution.completed",
            eventId,
            clientId: normalized.clientId,
            timestamp: new Date().toISOString(),
            attempt,
          });
          return {
            kind: "success" as const,
            content: outcome.content,
            finishReason: outcome.finishReason,
            attempt,
          };
        }
        const attempt = { ...outcome.attempt, attemptIndex };
        bus.publish({
          eventType: "execution.completed",
          eventId,
          clientId: normalized.clientId,
          timestamp: new Date().toISOString(),
          attempt,
        });
        return {
          kind: "failure" as const,
          attempt,
        };
      },
    });
    const totalLatencyMs = Date.now() - requestStart;

    const teleEvent = coreTelemetry.buildTelemetryEvent({
      eventId,
      receivedAt: normalized.receivedAt,
      clientId: normalized.clientId,
      decision,
      attempts: fallbackOutcome.attempts,
      totalLatencyMs,
    });
    const redactedEvent = redaction.applyRedactionToTelemetry(teleEvent);
    deps.telemetryWriter.write(redactedEvent).catch((err) => {
      req.log.error({ err }, "telemetry write failed");
    });

    if (fallbackOutcome.finalResult.kind !== "success") {
      const failedAttempt = fallbackOutcome.finalResult.attempt;
      bus.publish({
        eventType: "result.failed",
        eventId,
        clientId: normalized.clientId,
        timestamp: new Date().toISOString(),
        totalLatencyMs,
        terminalErrorClass: fallbackOutcome.terminalErrorClass,
      });
      bus.publish({
        eventType: "event.completed",
        eventId,
        clientId: normalized.clientId,
        timestamp: new Date().toISOString(),
        event: redactedEvent,
      });
      throw new LcaError({
        httpStatus: 502,
        code: fallbackOutcome.terminalErrorClass,
        message: `${failedAttempt.providerId}:${failedAttempt.modelId} failed with ${failedAttempt.errorClass}`,
        details: { attempts: fallbackOutcome.attempts, totalLatencyMs },
      });
    }

    bus.publish({
      eventType: "result.completed",
      eventId,
      clientId: normalized.clientId,
      timestamp: new Date().toISOString(),
      totalLatencyMs,
      terminalErrorClass: "none",
    });
    bus.publish({
      eventType: "event.completed",
      eventId,
      clientId: normalized.clientId,
      timestamp: new Date().toISOString(),
      event: redactedEvent,
    });

    const successAttempt = fallbackOutcome.finalResult.attempt;
    const body: CompletionResponseBody = {
      requestId: eventId,
      providerId: successAttempt.providerId,
      modelId: successAttempt.modelId,
      content: fallbackOutcome.content ?? "",
      usage: {
        inputTokens: successAttempt.inputTokens ?? 0,
        outputTokens: successAttempt.outputTokens ?? 0,
      },
      finishReason: fallbackOutcome.finishReason ?? "stop",
      decision,
    };
    return reply.status(200).send(body);
  });
};

export default plugin;
