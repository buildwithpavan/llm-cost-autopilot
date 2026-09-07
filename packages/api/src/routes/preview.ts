import { randomUUID } from "node:crypto";

import type { FastifyPluginAsync } from "fastify";

import {
  completionRequestSchema,
  evaluation,
  routing,
  type NormalizedRequest,
  type RoutingDecision,
} from "@lca/core";

import { loadCatalogSnapshot, type AppContext } from "../wiring.js";
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

    let decision: RoutingDecision;
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
      throw new LcaError({
        httpStatus: 422,
        code: "provider_unavailable",
        message,
      });
    }
    return reply.status(200).send(decision);
  });
};

export default plugin;
