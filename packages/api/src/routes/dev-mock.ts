import type { FastifyPluginAsync } from "fastify";

import type { ErrorClass } from "@lca/core";
import { armMockFailure } from "@lca/providers";

import type { AppContext } from "../wiring.js";
import { LcaError } from "../plugins/errors.js";

/**
 * Dev-only endpoint. Arms every mock adapter in the registry to return
 * a real failure of `errorClass` on the next execute() call. This is the
 * mechanism the UI Milestone 2.5 demo uses to produce a genuine fallback
 * chain (attempt 0 fails, attempt 1 falls back and succeeds).
 *
 * Registered only when NODE_ENV !== "production".
 */
const plugin: FastifyPluginAsync<AppContext> = async (fastify, deps) => {
  fastify.post<{ Body: { errorClass?: ErrorClass } }>(
    "/v1/dev/mock/arm-failure",
    async (req, reply) => {
      const body = (req.body ?? {}) as { errorClass?: ErrorClass };
      const errClass: ErrorClass = body.errorClass ?? "upstream_5xx";
      if (
        errClass !== "timeout" &&
        errClass !== "rate_limit" &&
        errClass !== "upstream_5xx" &&
        errClass !== "provider_unavailable"
      ) {
        throw new LcaError({
          httpStatus: 400,
          code: "invalid_request",
          message: `errorClass ${errClass} is not a transient class; fallback would not trigger`,
        });
      }
      let armed = 0;
      for (const adapter of deps.registry.list()) {
        if (armMockFailure(adapter, errClass)) armed += 1;
      }
      return reply.status(200).send({ armed, errorClass: errClass });
    },
  );
};

export default plugin;
