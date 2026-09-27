import type { Db } from "@lca/persistence";
import { readProviderHealthStates } from "@lca/persistence";
import type { FastifyPluginAsync } from "fastify";

interface ProviderHealthDeps {
  db: Db;
}

/**
 * Bearer-authenticated read of the scheduler's latest persisted provider health.
 * Read-only: it never probes providers or mutates health state.
 */
const providerHealth: FastifyPluginAsync<ProviderHealthDeps> = async (fastify, opts) => {
  fastify.get("/v1/health/providers", async (_req, reply) => {
    const states = await readProviderHealthStates(opts.db);
    return reply.status(200).send(states);
  });
};

export default providerHealth;
