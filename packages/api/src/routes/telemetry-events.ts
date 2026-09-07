import type { FastifyPluginAsync } from "fastify";

import { queryEvents } from "@lca/persistence";

import type { AppContext } from "../wiring.js";

const plugin: FastifyPluginAsync<AppContext> = async (fastify, deps) => {
  fastify.get("/v1/telemetry/events", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const filters: Parameters<typeof queryEvents>[1] = {};
    if (q["clientId"]) filters.clientId = q["clientId"];
    if (q["providerId"]) filters.providerId = q["providerId"];
    if (q["modelId"]) filters.modelId = q["modelId"];
    if (q["since"]) filters.since = q["since"];
    if (q["until"]) filters.until = q["until"];
    if (q["limit"]) filters.limit = Number(q["limit"]);
    if (q["cursor"]) filters.cursor = q["cursor"];
    const page = await queryEvents(deps.db, filters);
    return reply.status(200).send(page);
  });
};

export default plugin;
