import { randomUUID } from "node:crypto";

import type { FastifyPluginAsync } from "fastify";

import {
  completionRequestSchema,
  evaluation,
  type NormalizedRequest,
} from "@lca/core";

import { loadCatalogSnapshot, type AppContext } from "../wiring.js";
import { resolveRoutingDecision } from "../routing/resolve-decision.js";
import { LcaError } from "../plugins/errors.js";

const plugin: FastifyPluginAsync<AppContext> = async (fastify, deps) => {
  fastify.post("/v1/routing/preview", async (req, reply) => {
    const parsed = completionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new LcaError({
        httpStatus: 400,
        code: "invalid_request",
        message: "malformed request",
        details: { issues: parsed.error.issues },
      });
    }

    const clientId = (req as unknown as { lca: { clientId: string } }).lca.clientId;
    const normalized: NormalizedRequest = {
      requestId: randomUUID(),
      clientId,
      receivedAt: new Date().toISOString(),
      messages: parsed.data.messages,
      requirements: {
        requiredCapabilities: parsed.data.requirements?.requiredCapabilities ?? [],
        maxLatencyMs: parsed.data.requirements?.maxLatencyMs ?? null,
        maxCostUsd: parsed.data.requirements?.maxCostUsd ?? null,
        minQualityTier: parsed.data.requirements?.minQualityTier ?? null,
      },
      override: parsed.data.override ?? null,
      estimatedInputTokens: evaluation.estimateInputTokens(parsed.data.messages),
    };

    const snapshot = await loadCatalogSnapshot(deps);

    // Preview mirrors /v1/completions routing resolution (operator_rule >
    // client_override > autopilot) but is strictly read-only: no provider
    // invocation, no telemetry writes, and no event publishing.
    const rules = (await deps.ruleStore?.snapshot()) ?? [];
    const { decision } = resolveRoutingDecision({
      request: normalized,
      rules,
      snapshot,
    });

    return reply.status(200).send(decision);
  });
};

export default plugin;

