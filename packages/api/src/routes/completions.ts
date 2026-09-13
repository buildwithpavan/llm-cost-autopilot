import { randomUUID } from "node:crypto";

import type { FastifyPluginAsync, FastifyRequest } from "fastify";

import {
  completionRequestSchema,
  evaluation,
  overrides as coreOverrides,
  redaction,
  routing,
  telemetry as coreTelemetry,
  type CompletionRequest,
  type NormalizedRequest,
  type NormalizedResponse,
  type RationaleEntry,
  type RoutingDecision,
} from "@lca/core";
import type { OperatorRuleStore, TelemetryWriter } from "@lca/persistence";

import { loadCatalogSnapshot, type AppContext, type CatalogSnapshot } from "../wiring.js";
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

/** Verify that the target of an override or operator pin exists in the current catalog. */
function validatePinAgainstCatalog(
  pin: { providerId?: string | null; modelId?: string | null },
  snapshot: CatalogSnapshot,
): { providerId: string; modelId: string } {
  const candidates = snapshot.models.filter((m) => {
    if (pin.providerId && m.providerId !== pin.providerId) return false;
    if (pin.modelId && m.modelId !== pin.modelId) return false;
    return true;
  });
  if (candidates.length === 0) {
    throw new LcaError({
      httpStatus: 422,
      code: "override_target_missing",
      message: `override target provider=${pin.providerId ?? "*"} model=${pin.modelId ?? "*"} is not in the healthy catalog`,
    });
  }
  // Deterministic tiebreak: first alphabetical modelId under the pinned provider.
  candidates.sort((a, b) => a.modelId.localeCompare(b.modelId));
  const chosen = candidates[0]!;
  return { providerId: chosen.providerId, modelId: chosen.modelId };
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

    // Resolve override precedence (operator > client > autopilot).
    const rules = deps.ruleStore ? await deps.ruleStore.snapshot() : [];
    const resolution = coreOverrides.resolveOverride({ request: normalized, rules });

    bus.publish({
      eventType: "governance.completed",
      eventId,
      clientId: normalized.clientId,
      timestamp: new Date().toISOString(),
      decisionSource: resolution.effectiveSource,
      shadowedSource: resolution.shadowedSource,
      matchedRuleId: resolution.matchedRuleId ?? null,
    });

    let decision: RoutingDecision;
    if (resolution.pin) {
      // Validate that the pin target exists in the healthy catalog before any provider call.
      const pin = resolution.pin as { providerId?: string | null; modelId?: string | null };
      const target = validatePinAgainstCatalog(
        { providerId: pin.providerId ?? null, modelId: pin.modelId ?? null },
        snapshot,
      );
      const rationale: RationaleEntry[] = [
        {
          factor: "override",
          verdict: "preferred",
          note:
            resolution.effectiveSource === "operator_rule"
              ? `autonomous scoring bypassed by operator_rule ${resolution.matchedRuleId ?? ""}${
                  resolution.shadowedSource ? " (shadowed client_override)" : ""
                }`.trim()
              : "autonomous scoring bypassed by client_override",
        },
      ];
      decision = {
        decisionSource: resolution.effectiveSource,
        shadowedSource: resolution.shadowedSource,
        candidateRanking: [
          {
            providerId: target.providerId,
            modelId: target.modelId,
            included: true,
            exclusionReason: null,
            scoreBreakdown: { override: 1 },
          },
        ],
        chosenProviderId: target.providerId,
        chosenModelId: target.modelId,
        rationale,
        pricingTableVersionId: snapshot.pricingTable.versionId,
        estimatedCostUsd: "0",
      };
    } else {
      try {
        decision = routing.decideRoute({
          request: normalized,
          catalog: snapshot.models,
          pricingTable: snapshot.pricingTable,
        });
      } catch (err) {
        const message = (err as Error).message;
        if (/context/i.test(message)) {
          throw new LcaError({ httpStatus: 422, code: "context_exceeded", message });
        }
        if (/no candidate/i.test(message) || /empty catalog/i.test(message)) {
          throw new LcaError({
            httpStatus: 422,
            code: "provider_unavailable",
            message,
          });
        }
        throw err;
      }
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
