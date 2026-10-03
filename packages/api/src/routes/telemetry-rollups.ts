import type { FastifyPluginAsync } from "fastify";

import { queryRollups } from "@lca/persistence";

import type { AppContext } from "../wiring.js";
import { parseIsoDateParam } from "./query-params.js";

const plugin: FastifyPluginAsync<AppContext> = async (fastify, deps) => {
  fastify.get("/v1/telemetry/rollups", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const filters: Parameters<typeof queryRollups>[1] = {};
    if (q["providerId"]) filters.providerId = q["providerId"];
    if (q["modelId"]) filters.modelId = q["modelId"];
    if (q["fromDate"]) filters.fromDate = parseIsoDateParam(q["fromDate"], "fromDate").toISOString();
    if (q["toDate"]) filters.toDate = parseIsoDateParam(q["toDate"], "toDate").toISOString();
    const rows = await queryRollups(deps.db, filters);
    return reply.status(200).send(rows);
  });
};

export default plugin;
