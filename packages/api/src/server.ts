import { randomUUID } from "node:crypto";
import { URL } from "node:url";

import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";

import type { Db, OperatorRuleStore, BudgetStore, TelemetryWriter } from "@lca/persistence";
import type { ProviderRegistry } from "@lca/providers";

import type { LcaConfig } from "./config.js";
import { getSharedMetrics, type Metrics } from "./plugins/metrics.js";
import { policyFromConfig } from "./routing/provider-attempt.js";
import {
  circuitConfigFrom,
  createCircuitBreaker,
  type CircuitBreaker,
} from "./routing/circuit-breaker.js";
import authPlugin from "./plugins/auth.js";
import { errorHandler } from "./plugins/errors.js";
import healthRoute from "./routes/health.js";
import providerHealthRoute from "./routes/provider-health.js";
import completionsRoute from "./routes/completions.js";
import previewRoute from "./routes/preview.js";
import routingSimulateRoute from "./routes/routing-simulate.js";
import catalogRoute from "./routes/catalog.js";
import telemetryEventsRoute from "./routes/telemetry-events.js";
import telemetrySummaryRoute from "./routes/telemetry-summary.js";
import telemetryTimeseriesRoute from "./routes/telemetry-timeseries.js";
import telemetryAnomaliesRoute from "./routes/telemetry-anomalies.js";
import telemetryOptimizationRoute from "./routes/telemetry-optimization.js";
import telemetryRollupsRoute from "./routes/telemetry-rollups.js";
import telemetryReplayRoute from "./routes/telemetry-replay.js";
import telemetryBudgetDecisionsRoute from "./routes/telemetry-budget-decisions.js";
import telemetryStreamRoute from "./routes/telemetry-stream.js";
import rulesRoute from "./routes/rules.js";
import budgetsRoute from "./routes/budgets.js";
import keysRoute from "./routes/keys.js";
import devMockRoute from "./routes/dev-mock.js";

export interface ServerDeps {
  config: LcaConfig;
  db: Db;
  registry: ProviderRegistry;
  telemetryWriter: TelemetryWriter;
  ruleStore?: OperatorRuleStore;
  budgetStore?: BudgetStore;
  metrics?: Metrics;
  circuitBreaker?: CircuitBreaker;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Loopback-only origins the development CORS hook will reflect (never arbitrary origins). */
function isLoopbackOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

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

  // Security response headers. The API serves only JSON/SSE (never HTML), so the
  // CSP is locked down fully; cross-origin resource policy is relaxed because the
  // separate-origin dashboard reads these responses via CORS.
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    frameguard: { action: "deny" },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  // Permissive CORS for local development only. Reflection is restricted to
  // loopback origins so that, even if NODE_ENV is accidentally left unset, the
  // API never reflects an arbitrary external origin with credentials. Production
  // deploys front the API with a gateway that enforces an origin allowlist.
  const corsAllow = deps.config.NODE_ENV !== "production";
  if (corsAllow) {
    app.log.warn(
      "non-production mode: loopback-only dev CORS and dev-only routes are enabled; set NODE_ENV=production for deployments",
    );
    app.addHook("onRequest", async (req, reply) => {
      const origin = req.headers.origin;
      if (origin && isLoopbackOrigin(origin)) {
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

  // Process-local provider circuit breaker. Transitions update bounded metrics
  // and emit structured operational logs (provider id only; no request content).
  const circuitBreaker =
    deps.circuitBreaker ??
    createCircuitBreaker(circuitConfigFrom(deps.config), {
      onTransition: (providerId, from, to) => {
        app.log.warn({ provider: providerId, from, to }, "provider circuit transition");
        metrics.circuitTransitionsTotal.inc({ to });
        metrics.circuitOpenProviders.set(circuitBreaker.openProviderCount());
      },
    });

  await app.register(completionsRoute, {
    db: deps.db,
    registry: deps.registry,
    telemetryWriter: deps.telemetryWriter,
    metrics,
    providerAttempt: policyFromConfig(deps.config),
    circuitBreaker,
    ...(deps.ruleStore ? { ruleStore: deps.ruleStore } : {}),
    ...(deps.budgetStore ? { budgetStore: deps.budgetStore } : {}),
  });
  await app.register(previewRoute, {
    db: deps.db,
    registry: deps.registry,
    ...(deps.ruleStore ? { ruleStore: deps.ruleStore } : {}),
    ...(deps.budgetStore ? { budgetStore: deps.budgetStore } : {}),
  });
  await app.register(routingSimulateRoute, {
    db: deps.db,
    registry: deps.registry,
    ...(deps.ruleStore ? { ruleStore: deps.ruleStore } : {}),
    ...(deps.budgetStore ? { budgetStore: deps.budgetStore } : {}),
  });
  await app.register(catalogRoute, { db: deps.db, registry: deps.registry });
  await app.register(providerHealthRoute, { db: deps.db });
  await app.register(telemetryEventsRoute, { db: deps.db, registry: deps.registry });
  await app.register(telemetrySummaryRoute, { db: deps.db, registry: deps.registry });
  await app.register(telemetryTimeseriesRoute, { db: deps.db, registry: deps.registry });
  await app.register(telemetryAnomaliesRoute, {
    db: deps.db,
    registry: deps.registry,
    anomalyConfig: {
      minHistory: deps.config.LCA_ANOMALY_MIN_HISTORY,
      relThreshold: String(deps.config.LCA_ANOMALY_REL_THRESHOLD),
      criticalRelThreshold: String(deps.config.LCA_ANOMALY_CRIT_REL_THRESHOLD),
      minAbsoluteUsd: deps.config.LCA_ANOMALY_MIN_ABS_USD,
    },
  });
  await app.register(telemetryOptimizationRoute, {
    db: deps.db,
    registry: deps.registry,
    optimizationConfig: {
      concentrationRatioThreshold: deps.config.LCA_OPT_CONCENTRATION_RATIO,
      minSpendUsd: deps.config.LCA_OPT_MIN_SPEND_USD,
      budgetPressureRatioThreshold: deps.config.LCA_OPT_BUDGET_PRESSURE_RATIO,
      pricingComparisonMinDeltaUsd: deps.config.LCA_OPT_PRICING_MIN_DELTA_USD,
      maxPricingAlternatives: deps.config.LCA_OPT_MAX_PRICING_ALTERNATIVES,
    },
    ...(deps.ruleStore ? { ruleStore: deps.ruleStore } : {}),
    ...(deps.budgetStore ? { budgetStore: deps.budgetStore } : {}),
  });
  await app.register(telemetryRollupsRoute, { db: deps.db, registry: deps.registry });
  await app.register(telemetryReplayRoute, { db: deps.db, registry: deps.registry });
  await app.register(telemetryBudgetDecisionsRoute, { db: deps.db, registry: deps.registry });
  await app.register(telemetryStreamRoute, { db: deps.db, registry: deps.registry });
  if (deps.ruleStore) {
    await app.register(rulesRoute, { ruleStore: deps.ruleStore });
  }
  if (deps.budgetStore) {
    await app.register(budgetsRoute, { db: deps.db, budgetStore: deps.budgetStore });
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
