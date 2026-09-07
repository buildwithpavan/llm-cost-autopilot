import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { verifyApiKey, type Db } from "@lca/persistence";
import fp from "fastify-plugin";

import { LcaError } from "./errors.js";

declare module "fastify" {
  interface FastifyRequest {
    lca: { clientId: string; keyId: string };
  }
}

export interface AuthPluginOptions {
  db: Db;
  /** Paths that bypass authentication. */
  publicPaths: readonly string[];
}

const plugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, opts) => {
  fastify.decorateRequest("lca", null as unknown as FastifyRequest["lca"]);

  fastify.addHook("onRequest", async (req, _reply) => {
    if (opts.publicPaths.includes(req.routeOptions.url ?? req.url)) return;
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw new LcaError({
        httpStatus: 401,
        code: "unauthorized",
        message: "missing or malformed Authorization header",
      });
    }
    const token = header.slice("Bearer ".length).trim();
    const result = await verifyApiKey(opts.db, token);
    if (!result) {
      throw new LcaError({
        httpStatus: 401,
        code: "unauthorized",
        message: "invalid API key",
      });
    }
    (req as unknown as { lca: { clientId: string; keyId: string } }).lca = {
      clientId: result.clientId,
      keyId: result.keyId,
    };
  });
};

export default fp(plugin, { name: "lca-auth" });
