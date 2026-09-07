import type { FastifyPluginAsync } from "fastify";

import { loadCatalogSnapshot, type AppContext } from "../wiring.js";

const plugin: FastifyPluginAsync<AppContext> = async (fastify, deps) => {
  fastify.get("/v1/catalog", async (_req, reply) => {
    const snapshot = await loadCatalogSnapshot(deps);
    return reply.status(200).send({
      pricingTableVersionId: snapshot.pricingTable.versionId,
      models: snapshot.models,
    });
  });
};

export default plugin;
