import { randomUUID } from "node:crypto";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";

import type { Model } from "@lca/core";
import {
  createApiKey,
  createBudgetStore,
  createDb,
  createPool,
  createTelemetryWriter,
  runMigrations,
  setProviderHealth,
  type BudgetStore,
  type Db,
  type TelemetryWriter,
} from "@lca/persistence";
import { createMockAdapter, createRegistry } from "@lca/providers";

import { buildServer } from "../../src/server.js";
import { loadConfig } from "../../src/config.js";
import { createMetrics, type Metrics } from "../../src/plugins/metrics.js";
import { createCircuitBreaker, type CircuitBreaker } from "../../src/routing/circuit-breaker.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

const CLIENT = "faults-integ";
const PRICING = "faults-integ-pricing";

// Single-model adapters so ranking is a deterministic two-candidate chain
// [mock-cheap:small, mock-fast:default]; the fallback candidate for a cheap
// failure is a different provider.
const cheapModel: Model = {
  modelId: "mock-cheap:small",
  providerId: "mock-cheap",
  capabilities: [],
  contextWindow: 8_000,
  qualityTier: "standard",
  publishedLatencyProfile: { p50Ms: 150, p95Ms: 400 },
  publishedReliabilityScore: 0.99,
  pricingDescriptorRef: "mock-cheap:small",
};
const fastModel: Model = {
  modelId: "mock-fast:default",
  providerId: "mock-fast",
  capabilities: [],
  contextWindow: 16_000,
  qualityTier: "standard",
  publishedLatencyProfile: { p50Ms: 40, p95Ms: 120 },
  publishedReliabilityScore: 0.98,
  pricingDescriptorRef: "mock-fast:default",
};

gated("reliability fault-injection + concurrency (Phase 14)", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let secret: string;
  let writer: TelemetryWriter;
  let budgetStore: BudgetStore;
  let metrics: Metrics;
  let breaker: CircuitBreaker;
  let cheap: ReturnType<typeof createMockAdapter>;
  let fast: ReturnType<typeof createMockAdapter>;

  function failUpstream(providerId: string, modelId: string, pricingVersion: string) {
    const now = new Date().toISOString();
    return {
      kind: "failure" as const,
      attempt: { attemptIndex: 0, providerId, modelId, startedAt: now, endedAt: now, latencyMs: 0, inputTokens: null, outputTokens: null, errorClass: "upstream_5xx" as const, estimatedCostUsd: "0", actualCostUsd: null, pricingTableVersionId: pricingVersion },
    };
  }

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
    await db.deleteFrom("api_keys").where("label", "=", CLIENT).execute();
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();
    await db.deleteFrom("spend_budgets").execute();
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db.insertInto("pricing_tables").values({ version_id: PRICING, effective_from: new Date(), is_active: false }).execute();
    await setProviderHealth(db, "mock-cheap", true, 0);
    await setProviderHealth(db, "mock-fast", true, 0);
    const created = await createApiKey(db, { clientId: CLIENT, label: CLIENT });
    secret = created.secret;
    budgetStore = createBudgetStore(db);
    writer = createTelemetryWriter(db, { batchSize: 1, flushEveryMs: 0 });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  beforeEach(async () => {
    await db.deleteFrom("spend_budgets").execute();
    budgetStore.invalidate();
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();
  });

  /** Build a fresh server with the given env overrides and a fresh metrics/breaker. */
  async function makeApp(env: Record<string, string> = {}): Promise<void> {
    const registry = createRegistry();
    cheap = createMockAdapter({ providerId: "mock-cheap", models: [cheapModel] });
    fast = createMockAdapter({ providerId: "mock-fast", models: [fastModel] });
    registry.register(cheap);
    registry.register(fast);
    metrics = createMetrics();
    breaker = createCircuitBreaker({ enabled: true, failureThreshold: 5, cooldownMs: 30_000 });
    const config = loadConfig({ ...process.env, DATABASE_URL, ...env });
    app = await buildServer({ config, db, registry, telemetryWriter: writer, budgetStore, metrics, circuitBreaker: breaker });
    await app.ready();
  }

  function complete(cid?: string) {
    const r = supertest(app.server).post("/v1/completions").set("authorization", `Bearer ${secret}`);
    if (cid) r.set("x-request-id", cid);
    return r.send({ messages: [{ role: "user", content: "hi" }] });
  }
  async function scrape(): Promise<string> {
    return (await supertest(app.server).get("/metrics")).text;
  }
  function reqCount(text: string, outcome: string): number {
    const m = new RegExp(`^lca_requests_total\\{outcome="${outcome}"\\} (\\d+)`, "m").exec(text);
    return m ? Number(m[1]) : 0;
  }
  function histCount(text: string, name: string): number {
    const m = new RegExp(`^${name}_count (\\d+)`, "m").exec(text);
    return m ? Number(m[1]) : 0;
  }
  function gaugeOrCounter(text: string, name: string): number {
    const m = new RegExp(`^${name} (\\d+)`, "m").exec(text);
    return m ? Number(m[1]) : 0;
  }

  // ---- Fault-injection matrix --------------------------------------------

  it("success on the first candidate counts exactly one logical request", async () => {
    await makeApp();
    const before = await scrape();
    const res = await complete();
    const after = await scrape();
    expect(res.status).toBe(200);
    expect(reqCount(after, "success") - reqCount(before, "success")).toBe(1);
    expect(histCount(after, "lca_request_duration_seconds") - histCount(before, "lca_request_duration_seconds")).toBe(1);
  });

  it("a retryable failure recovers via retry on the same provider (one logical request, no fallback)", async () => {
    await makeApp({ LCA_PROVIDER_MAX_RETRIES: "2", LCA_PROVIDER_RETRY_BACKOFF_MS: "0" });
    let n = 0;
    const orig = cheap.execute.bind(cheap);
    vi.spyOn(cheap, "execute").mockImplementation(async (input, signal) => {
      n += 1;
      return n === 1 ? failUpstream("mock-cheap", input.modelId, input.pricingTable.versionId) : orig(input, signal);
    });
    const fastSpy = vi.spyOn(fast, "execute");
    const before = await scrape();
    const res = await complete();
    const after = await scrape();
    expect(res.status).toBe(200);
    expect(res.body.providerId).toBe("mock-cheap");
    expect(n).toBe(2);
    expect(fastSpy).not.toHaveBeenCalled();
    expect(reqCount(after, "success") - reqCount(before, "success")).toBe(1);
  });

  it("retry exhaustion on the chosen candidate falls back to the next provider", async () => {
    await makeApp({ LCA_PROVIDER_MAX_RETRIES: "2", LCA_PROVIDER_RETRY_BACKOFF_MS: "0" });
    let cheapCalls = 0;
    vi.spyOn(cheap, "execute").mockImplementation(async (input) => {
      cheapCalls += 1;
      return failUpstream("mock-cheap", input.modelId, input.pricingTable.versionId);
    });
    const res = await complete();
    expect(res.status).toBe(200);
    expect(res.body.providerId).toBe("mock-fast");
    expect(cheapCalls).toBe(3); // maxRetries + 1, bounded
  });

  it("a non-retryable client failure terminates immediately (no retry, no fallback)", async () => {
    // `invalid_request` is a deterministic client error: it is neither retried
    // nor eligible for fallback, so the chain stops after a single physical call.
    await makeApp({ LCA_PROVIDER_MAX_RETRIES: "3", LCA_PROVIDER_RETRY_BACKOFF_MS: "0" });
    let cheapCalls = 0;
    vi.spyOn(cheap, "execute").mockImplementation(async (input) => {
      cheapCalls += 1;
      const now = new Date().toISOString();
      return { kind: "failure" as const, attempt: { attemptIndex: 0, providerId: "mock-cheap", modelId: input.modelId, startedAt: now, endedAt: now, latencyMs: 0, inputTokens: null, outputTokens: null, errorClass: "invalid_request" as const, estimatedCostUsd: "0", actualCostUsd: null, pricingTableVersionId: input.pricingTable.versionId } };
    });
    const fastSpy = vi.spyOn(fast, "execute");
    const res = await complete();
    expect(res.status).toBe(502);
    expect(cheapCalls).toBe(1); // no retry for a deterministic client error
    expect(fastSpy).not.toHaveBeenCalled(); // invalid_request is not fallback-eligible
  });

  it("a budget-blocked request never enters provider execution (zero attempts)", async () => {
    await makeApp();
    await db.insertInto("telemetry_events").values({
      event_id: randomUUID(), received_at: new Date().toISOString(), client_id: CLIENT,
      decision_source: "autopilot", shadowed_source: null, effective_provider_id: "mock-cheap",
      effective_model_id: "mock-cheap:small", attempts: JSON.stringify([]), aggregated_input_tokens: 1,
      aggregated_output_tokens: 1, total_latency_ms: 1, terminal_error_class: "none",
      estimated_cost_usd: "5.000000", actual_cost_usd: null, pricing_table_version_id: PRICING,
      reconciled: null, routing_rationale: JSON.stringify({}),
    }).execute();
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "1.000000", action: "block" });
    const cheapSpy = vi.spyOn(cheap, "execute");
    const fastSpy = vi.spyOn(fast, "execute");
    const res = await complete();
    expect(res.status).toBe(429);
    expect(cheapSpy).not.toHaveBeenCalled();
    expect(fastSpy).not.toHaveBeenCalled();
  });

  // ---- Logical-request deadline ------------------------------------------

  it("a logical-request deadline halts fallback, returns a terminal error, and does not penalize the skipped provider's circuit", async () => {
    // Tiny deadline (5ms) with a slow first candidate (~40ms) guarantees the
    // fallback candidate is skipped once the deadline is exhausted.
    await makeApp({ LCA_REQUEST_DEADLINE_MS: "5", LCA_PROVIDER_TIMEOUT_MS: "1000", LCA_PROVIDER_MAX_RETRIES: "0" });
    vi.spyOn(cheap, "execute").mockImplementation(async (input) => {
      await new Promise((r) => setTimeout(r, 40));
      return failUpstream("mock-cheap", input.modelId, input.pricingTable.versionId);
    });
    const fastSpy = vi.spyOn(fast, "execute");

    const before = await scrape();
    const res = await complete();
    const after = await scrape();

    // Both candidates failed (second skipped by deadline) → fallback exhausted.
    expect(res.status).toBe(502);
    expect(fastSpy).not.toHaveBeenCalled(); // deadline skipped the fallback entirely
    // The deadline metric incremented exactly once for this request.
    expect(gaugeOrCounter(after, "lca_request_deadline_exhausted_total") - gaugeOrCounter(before, "lca_request_deadline_exhausted_total")).toBe(1);
    // The skipped provider's circuit is untouched (the request, not the provider, is at fault).
    expect(breaker.getState("mock-fast")).toBe("closed");
  });

  it("with the deadline disabled (default 0), fallback proceeds normally", async () => {
    await makeApp();
    vi.spyOn(cheap, "execute").mockImplementation(async (input) => failUpstream("mock-cheap", input.modelId, input.pricingTable.versionId));
    const res = await complete();
    expect(res.status).toBe(200);
    expect(res.body.providerId).toBe("mock-fast");
  });

  // ---- Concurrency --------------------------------------------------------

  it("counts each of many concurrent requests exactly once (single finalization, no shared-state corruption)", async () => {
    await makeApp();
    // Start listening so concurrent supertest requests share one bound port
    // (supertest otherwise tries to listen() the same server per request).
    await app.listen({ port: 0, host: "127.0.0.1" });
    const N = 16;
    const before = await scrape();
    const results = await Promise.all(Array.from({ length: N }, () => complete()));
    const after = await scrape();
    for (const r of results) expect(r.status).toBe(200);
    expect(reqCount(after, "success") - reqCount(before, "success")).toBe(N);
    expect(histCount(after, "lca_request_duration_seconds") - histCount(before, "lca_request_duration_seconds")).toBe(N);
  });
});
