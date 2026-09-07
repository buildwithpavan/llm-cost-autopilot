import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createApiKey, listApiKeyMetadata, revokeApiKey, type Db } from "@lca/persistence";

import { LcaError } from "../plugins/errors.js";

export interface KeysDeps {
  db: Db;
}

const createBodySchema = z.object({
  clientId: z.string().min(1),
  label: z.string().min(1),
});

const plugin: FastifyPluginAsync<KeysDeps> = async (fastify, deps) => {
  fastify.get("/v1/keys", async (_req, reply) => {
    const list = await listApiKeyMetadata(deps.db);
    return reply.status(200).send(list);
  });

  fastify.post("/v1/keys", async (req, reply) => {
    const parsed = createBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new LcaError({
        httpStatus: 400,
        code: "invalid_request",
        message: "malformed key create body",
        details: { issues: parsed.error.issues },
      });
    }
    const { keyId, secret, metadata } = await createApiKey(deps.db, parsed.data);
    // `secret` is returned exactly once here and never in any subsequent response.
    return reply.status(201).send({
      keyId,
      secret,
      clientId: metadata.clientId,
      label: metadata.label,
      createdAt: metadata.createdAt,
    });
  });

  fastify.delete<{ Params: { keyId: string } }>("/v1/keys/:keyId", async (req, reply) => {
    await revokeApiKey(deps.db, req.params.keyId);
    return reply.status(204).send();
  });
};

export default plugin;
