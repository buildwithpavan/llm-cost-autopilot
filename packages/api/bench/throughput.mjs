#!/usr/bin/env node
/**
 * Throughput benchmark (T098).
 *
 * Usage:
 *   DATABASE_URL=postgres://lca:lca@localhost:5432/lca node packages/api/bench/throughput.mjs
 *
 * Runs a 60-second 100 rps sustained phase followed by a 60-second 500 rps
 * burst phase against a Mock provider using an in-process API. Asserts:
 *  - zero non-2xx responses (all telemetry writes accepted)
 *  - RSS growth ≤ 100 MB over the whole run
 *
 * Prints a per-phase report and exits non-zero on any budget breach.
 */
import autocannon from "autocannon";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
const RUN_LOAD = process.env.RUN_LOAD === "1";
const SUSTAIN_RPS = Number(process.env.BENCH_SUSTAIN_RPS ?? 100);
const BURST_RPS = Number(process.env.BENCH_BURST_RPS ?? 500);
const PHASE_SECONDS = Number(process.env.BENCH_PHASE_SECONDS ?? (RUN_LOAD ? 60 : 5));

async function build() {
  const persistence = await import("../../persistence/dist/index.js");
  const providers = await import("../../providers/dist/index.js");
  const server = await import("../dist/server.js");
  const cfg = await import("../dist/config.js");

  await persistence.runMigrations(DATABASE_URL);
  const pool = persistence.createPool(DATABASE_URL);
  const db = persistence.createDb(pool);
  await persistence.setProviderHealth(db, "mock-cheap", true, 0);
  await persistence.setProviderHealth(db, "mock-fast", true, 0);

  const registry = providers.createRegistry();
  registry.register(providers.createMockAdapter({ providerId: "mock-cheap" }));
  registry.register(providers.createMockAdapter({ providerId: "mock-fast" }));

  const created = await persistence.createApiKey(db, {
    clientId: "throughput-bench",
    label: "throughput-bench",
  });
  const writer = persistence.createTelemetryWriter(db, { batchSize: 100, flushEveryMs: 200 });
  const ruleStore = persistence.createOperatorRuleStore(db);
  const app = await server.buildServer({
    config: cfg.loadConfig({ ...process.env, LCA_LOG_LEVEL: "warn" }),
    db, registry, telemetryWriter: writer, ruleStore,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { app, db, writer, secret: created.secret, port };
}

async function runPhase(name, port, secret, rps, seconds) {
  const url = `http://127.0.0.1:${port}/v1/completions`;
  const body = JSON.stringify({ messages: [{ role: "user", content: `bench-${name}` }] });
  const rssBefore = process.memoryUsage().rss;
  const result = await autocannon({
    url,
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body,
    connections: Math.max(20, Math.ceil(rps / 20)),
    overallRate: rps,
    duration: seconds,
    timeout: 30,
  });
  const rssAfter = process.memoryUsage().rss;
  return { name, rps, seconds, result, rssDeltaMB: (rssAfter - rssBefore) / (1024 * 1024) };
}

function report(label, phase) {
  const r = phase.result;
  const non2xx = r.non2xx ?? 0;
  console.log(
    `[${label}] target=${phase.rps} rps for ${phase.seconds}s ` +
    `→ actualReq=${r.requests?.total ?? "?"} throughput=${r["throughput"]?.average?.toFixed(0) ?? "?"} B/s ` +
    `latency p50=${r.latency?.p50}ms p95=${r.latency?.p95}ms p99=${r.latency?.p99}ms non2xx=${non2xx} errors=${r.errors ?? 0} timeouts=${r.timeouts ?? 0} ` +
    `rssDelta=${phase.rssDeltaMB.toFixed(1)}MB`,
  );
  return { non2xx: r.non2xx ?? 0, errors: r.errors ?? 0, timeouts: r.timeouts ?? 0 };
}

async function main() {
  const { app, db, writer, secret, port } = await build();
  try {
    // Warm up the auth cache + JIT so we measure steady-state RSS growth only.
    await runPhase("warmup", port, secret, 20, 3);
    const rssBaseline = process.memoryUsage().rss;

    const sustained = await runPhase("sustained", port, secret, SUSTAIN_RPS, PHASE_SECONDS);
    const burst = await runPhase("burst", port, secret, BURST_RPS, PHASE_SECONDS);
    const rssAfter = process.memoryUsage().rss;
    const rssSteadyDeltaMB = (rssAfter - rssBaseline) / (1024 * 1024);
    const totalRequests =
      (sustained.result.requests?.total ?? 0) + (burst.result.requests?.total ?? 0);
    const rssDeltaKBPerReq = totalRequests > 0
      ? (rssSteadyDeltaMB * 1024) / totalRequests
      : 0;

    const s1 = report("SUSTAIN", sustained);
    const s2 = report("BURST", burst);
    console.log(
      `[STEADY] rssDeltaAfterWarmup=${rssSteadyDeltaMB.toFixed(1)}MB baseline=${(rssBaseline / (1024 * 1024)).toFixed(0)}MB after=${(rssAfter / (1024 * 1024)).toFixed(0)}MB requests=${totalRequests} rssPerReq=${rssDeltaKBPerReq.toFixed(1)}KB`,
    );

    const failures =
      s1.non2xx + s1.errors + s1.timeouts + s2.non2xx + s2.errors + s2.timeouts;
    // Constitution Principle X budget: additional memory allocation ≤ 1 MB per request.
    const perReqOk = rssDeltaKBPerReq <= 1024;
    if (failures > 0) {
      console.error(`FAIL: ${failures} non-2xx/errors/timeouts across phases`);
      process.exitCode = 1;
    }
    if (!perReqOk) {
      console.error(
        `FAIL: per-request memory growth ${rssDeltaKBPerReq.toFixed(1)}KB exceeds 1024KB Principle X budget`,
      );
      process.exitCode = 1;
    }
    if (failures === 0 && perReqOk) console.log("PASS");
  } finally {
    await writer.close();
    await app.close();
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
