import { randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";

import type { Db, OperatorRuleStore, TelemetryWriter } from "@lca/persistence";
import type { ProviderRegistry } from "@lca/providers";

import type { LcaConfig } from "./config.js";
import { getSharedMetrics, type Metrics } from "./plugins/metrics.js";
import authPlugin from "./plugins/auth.js";
import { errorHandler } from "./plugins/errors.js";
import healthRoute from "./routes/health.js";
import completionsRoute from "./routes/completions.js";
import previewRoute from "./routes/preview.js";
import catalogRoute from "./routes/catalog.js";
import telemetryEventsRoute from "./routes/telemetry-events.js";
import telemetryRollupsRoute from "./routes/telemetry-rollups.js";
import telemetryReplayRoute from "./routes/telemetry-replay.js";
import telemetryStreamRoute from "./routes/telemetry-stream.js";
import rulesRoute from "./routes/rules.js";
import keysRoute from "./routes/keys.js";
import devMockRoute from "./routes/dev-mock.js";

export interface ServerDeps {
  config: LcaConfig;
  db: Db;
  registry: ProviderRegistry;
  telemetryWriter: TelemetryWriter;
  ruleStore?: OperatorRuleStore;
  metrics?: Metrics;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const metrics = deps.metrics ?? getSharedMetrics();

  const app = Fastify({
    logger: {
      level: deps.config.LCA_LOG_LEVEL,
      redact: {
        paths: ["req.headers.authorization", 'req.headers["x-api-key"]'],
        censor: "[REDACTED:secret]",
      },
    },
    genReqId: (req) => {
      const supplied = req.headers["x-request-id"];
      if (typeof supplied === "string" && UUID_RE.test(supplied)) {
        return supplied;
      }
      return randomUUID();
    },
  });

  app.setErrorHandler(errorHandler);

  // Permissive CORS for development. Production deploys should front the API
  // with a gateway that enforces origin allowlisting.
  const corsAllow = deps.config.NODE_ENV !== "production";
  if (corsAllow) {
    app.addHook("onRequest", async (req, reply) => {
      const origin = req.headers.origin;
      if (origin) {
        reply.header("access-control-allow-origin", origin);
        reply.header("access-control-allow-credentials", "true");
        reply.header("access-control-allow-headers", "authorization, content-type, x-request-id");
        reply.header("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
        reply.header("access-control-expose-headers", "x-request-id");
      }
      if (req.method === "OPTIONS") {
        reply.header("access-control-max-age", "86400");
        return reply.status(204).send();
      }
    });
  }

  app.get("/metrics", async (_req, reply) => {
    reply.header("content-type", metrics.registry.contentType);
    return metrics.registry.metrics();
  });

  await app.register(healthRoute, { db: deps.db });

  await app.register(authPlugin, {
    db: deps.db,
    publicPaths: ["/v1/health", "/metrics"],
  });

  await app.register(completionsRoute, {
    db: deps.db,
    registry: deps.registry,
    telemetryWriter: deps.telemetryWriter,
    ...(deps.ruleStore ? { ruleStore: deps.ruleStore } : {}),
  });
  await app.register(previewRoute, { db: deps.db, registry: deps.registry });
  await app.register(catalogRoute, { db: deps.db, registry: deps.registry });
  await app.register(telemetryEventsRoute, { db: deps.db, registry: deps.registry });
  await app.register(telemetryRollupsRoute, { db: deps.db, registry: deps.registry });
  await app.register(telemetryReplayRoute, { db: deps.db, registry: deps.registry });
  await app.register(telemetryStreamRoute, { db: deps.db, registry: deps.registry });
  if (deps.ruleStore) {
    await app.register(rulesRoute, { ruleStore: deps.ruleStore });
  }
  await app.register(keysRoute, { db: deps.db });

  if (deps.config.NODE_ENV !== "production") {
    await app.register(devMockRoute, { db: deps.db, registry: deps.registry });
  }

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", String(req.id));
  });

  return app;
}
