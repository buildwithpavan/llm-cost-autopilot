import type { FastifyPluginAsync } from "fastify";

import { queryBudgetDecisions } from "@lca/persistence";

import type { AppContext } from "../wiring.js";

/**
 * Operator-facing audit read for budget decisions (warned/blocked). Additive and
 * separate from /v1/telemetry/events (which carries provider-execution events
 * only). Filters mirror the telemetry convention: clientId / since / until / limit.
 */
const plugin: FastifyPluginAsync<AppContext> = async (fastify, deps) => {
  fastify.get("/v1/telemetry/budget-decisions", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const filters: Parameters<typeof queryBudgetDecisions>[1] = {};
    if (q["clientId"]) filters.clientId = q["clientId"];
    if (q["since"]) filters.since = q["since"];
    if (q["until"]) filters.until = q["until"];
    if (q["limit"]) filters.limit = Number(q["limit"]);
    const decisions = await queryBudgetDecisions(deps.db, filters);
    return reply.status(200).send({ decisions });
  });
};

export default plugin;
