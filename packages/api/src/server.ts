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
import rulesRoute from "./routes/rules.js";
import keysRoute from "./routes/keys.js";

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
  if (deps.ruleStore) {
    await app.register(rulesRoute, { ruleStore: deps.ruleStore });
  }
  await app.register(keysRoute, { db: deps.db });

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", String(req.id));
  });

  return app;
}
