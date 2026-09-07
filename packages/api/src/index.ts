import {
  createDb,
  createHealthScheduler,
  createOperatorRuleStore,
  createPool,
  createRetentionJob,
  createTelemetryWriter,
  setProviderHealth,
} from "@lca/persistence";
import {
  createAnthropicAdapter,
  createMockFromEnv,
  createOpenAiAdapter,
  createRegistry,
} from "@lca/providers";

import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { startTracing } from "./plugins/tracing.js";
import { startReconciliationMetricLoop } from "./plugins/reconciliation-metric.js";

export const API_VERSION = "0.1.0";

async function main(): Promise<void> {
  const config = loadConfig();
  startTracing(config);
  const pool = createPool(config.DATABASE_URL);
  const db = createDb(pool);

  const active = await db
    .selectFrom("pricing_tables")
    .select("version_id")
    .where("is_active", "=", true)
    .executeTakeFirst();
  if (!active) {
     
    console.error(
      "cannot boot: no active pricing_tables row. run `npm run db:migrate && npm run db:seed`.",
    );
    process.exit(2);
  }

  const registry = createRegistry();
  registry.register(createMockFromEnv("mock-cheap"));
  registry.register(createMockFromEnv("mock-fast"));
  if (config.OPENAI_API_KEY) {
    registry.register(createOpenAiAdapter({ apiKey: config.OPENAI_API_KEY }));
    await setProviderHealth(db, "openai", true, 0);
  }
  if (config.ANTHROPIC_API_KEY) {
    registry.register(createAnthropicAdapter({ apiKey: config.ANTHROPIC_API_KEY }));
    await setProviderHealth(db, "anthropic", true, 0);
  }
  await setProviderHealth(db, "mock-cheap", true, 0);
  await setProviderHealth(db, "mock-fast", true, 0);

  const telemetryWriter = createTelemetryWriter(db, { batchSize: 100, flushEveryMs: 200 });
  const ruleStore = createOperatorRuleStore(db);
  const retentionJob = createRetentionJob(db);
  retentionJob.start();
  const stopReconciliationLoop = startReconciliationMetricLoop(db);
  const healthScheduler = createHealthScheduler(db, () => registry.list());
  healthScheduler.start();

  const app = await buildServer({ config, db, registry, telemetryWriter, ruleStore });
  const closeSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const sig of closeSignals) {
    process.once(sig, async () => {
      app.log.info({ sig }, "shutting down");
      retentionJob.stop();
      healthScheduler.stop();
      stopReconciliationLoop();
      await telemetryWriter.close();
      await app.close();
      await db.destroy();
      process.exit(0);
    });
  }

  await app.listen({ host: "0.0.0.0", port: config.PORT });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
     
    console.error(err);
    process.exit(1);
  });
}
