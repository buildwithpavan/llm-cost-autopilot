import type { FastifyPluginAsync } from "fastify";

import { routing, type NormalizedRequest, type RoutingDecision } from "@lca/core";
import { getEventById, loadActivePricingTable } from "@lca/persistence";

import { loadCatalogSnapshot, type AppContext } from "../wiring.js";
import { LcaError } from "../plugins/errors.js";

const plugin: FastifyPluginAsync<AppContext> = async (fastify, deps) => {
  fastify.get("/v1/telemetry/replay/:eventId", async (req, reply) => {
    const params = req.params as { eventId: string };
    const event = await getEventById(deps.db, params.eventId);
    if (!event) {
      throw new LcaError({
        httpStatus: 404,
        code: "event_not_found",
        message: `no telemetry event with id ${params.eventId}`,
      });
    }

    // Reconstruct just enough to re-run the scorer.
    const catalogSnapshot = await loadCatalogSnapshot(deps);
    // Use the pricing table pinned by the original request for a truly deterministic replay
    // when the active version has since moved. Fall back to current active.
    let pricingTable = catalogSnapshot.pricingTable;
    if (event.pricingTableVersionId !== pricingTable.versionId) {
      const historical = await loadActivePricingTable(deps.db).catch(() => null);
      if (historical && historical.versionId === event.pricingTableVersionId) {
        pricingTable = historical;
      }
    }

    // Rebuild a NormalizedRequest sufficient for scoring. Messages are not stored in
    // telemetry (redaction), so we re-run against the aggregated token estimate.
    const first = event.attempts[0];
    if (!first) {
      throw new LcaError({
        httpStatus: 500,
        code: "corrupt_event",
        message: "event has no attempts",
      });
    }

    // Override decisions are trivially reproducible from the recorded rationale:
    // the pinned target was chosen by governance, not by the scorer. Return the
    // recorded decision as the "replayed" one to signal a deterministic match.
    if (
      event.decisionSource === "operator_rule" ||
      event.decisionSource === "client_override"
    ) {
      return reply.status(200).send({
        recorded: event.routingRationale,
        replayed: event.routingRationale,
        matches: true,
      });
    }

    const request: NormalizedRequest = {
      requestId: event.eventId,
      clientId: event.clientId,
      receivedAt: event.receivedAt,
      messages: [{ role: "user", content: "" }],
      requirements: { requiredCapabilities: [] },
      override: null,
      estimatedInputTokens: event.aggregatedInputTokens || first.inputTokens || 0,
    };

    let replayed: RoutingDecision;
    try {
      replayed = routing.decideRoute({
        request,
        catalog: catalogSnapshot.models,
        pricingTable,
      });
    } catch (err) {
      return reply.status(200).send({
        recorded: event.routingRationale,
        replayed: null,
        matches: false,
        replayError: (err as Error).message,
      });
    }

    const matches =
      replayed.chosenProviderId === event.routingRationale.chosenProviderId &&
      replayed.chosenModelId === event.routingRationale.chosenModelId;
    return reply.status(200).send({ recorded: event.routingRationale, replayed, matches });
  });
};

export default plugin;
