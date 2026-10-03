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

const CLIENT = "circuit-integ";
const PRICING = "circuit-integ-pricing";
const COOLDOWN = 1_000;

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

gated("provider circuit breaker (Phase 9)", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let secret: string;
  let writer: TelemetryWriter;
  let budgetStore: BudgetStore;
  let metrics: Metrics;
  let breaker: CircuitBreaker;
  let clock: { t: number };
  let cheap: ReturnType<typeof createMockAdapter>;
  let fast: ReturnType<typeof createMockAdapter>;

  function failUpstream(providerId: string, modelId: string, pricingVersion: string) {
    const now = new Date().toISOString();
    return {
      kind: "failure" as const,
      attempt: { attemptIndex: 0, providerId, modelId, startedAt: now, endedAt: now, latencyMs: 0, inputTokens: null, outputTokens: null, errorClass: "upstream_5xx" as const, estimatedCostUsd: "0", actualCostUsd: null, pricingTableVersionId: pricingVersion },
    };
  }
  function spendRow(estimated: string) {
    return {
      event_id: randomUUID(), received_at: new Date().toISOString(), client_id: CLIENT,
      decision_source: "autopilot" as const, shadowed_source: null,
      effective_provider_id: "mock-cheap", effective_model_id: "mock-cheap:small",
      attempts: JSON.stringify([]), aggregated_input_tokens: 1, aggregated_output_tokens: 1,
      total_latency_ms: 1, terminal_error_class: "none", estimated_cost_usd: estimated,
      actual_cost_usd: null, pricing_table_version_id: PRICING, reconciled: null, routing_rationale: JSON.stringify({}),
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

  beforeEach(async () => {
    await db.deleteFrom("spend_budgets").execute();
    budgetStore.invalidate();
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();

    // Single-model adapters so ranking is [mock-cheap:small, mock-fast:default]:
    // the fallback candidate for a cheap failure is a DIFFERENT provider (fast).
    const registry = createRegistry();
    cheap = createMockAdapter({ providerId: "mock-cheap", models: [cheapModel] });
    fast = createMockAdapter({ providerId: "mock-fast", models: [fastModel] });
    registry.register(cheap);
    registry.register(fast);

    metrics = createMetrics();
    clock = { t: 0 };
    breaker = createCircuitBreaker(
      { enabled: true, failureThreshold: 2, cooldownMs: COOLDOWN },
      {
        now: () => clock.t,
        onTransition: (_p, _f, to) => {
          metrics.circuitTransitionsTotal.inc({ to });
          metrics.circuitOpenProviders.set(breaker.openProviderCount());
        },
      },
    );
    const config = loadConfig({ ...process.env, DATABASE_URL });
    app = await buildServer({ config, db, registry, telemetryWriter: writer, budgetStore, metrics, circuitBreaker: breaker });
    await app.ready();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  function complete(cid?: string) {
    const r = supertest(app.server).post("/v1/completions").set("authorization", `Bearer ${secret}`);
    if (cid) r.set("x-request-id", cid);
    return r.send({ messages: [{ role: "user", content: "hi" }] });
  }
  async function scrape(): Promise<string> {
    return (await supertest(app.server).get("/metrics")).text;
  }
  function metric(text: string, re: RegExp): number {
    const m = re.exec(text);
    return m ? Number(m[1]) : 0;
  }
  const reqSuccess = (t: string) => metric(t, /^lca_requests_total\{outcome="success"\} (\d+)/m);
  const blocked = (t: string) => metric(t, /^lca_circuit_blocked_total (\d+)/m);
  const openGauge = (t: string) => metric(t, /^lca_circuit_open_providers (\d+)/m);
  const toOpen = (t: string) => metric(t, /^lca_circuit_transitions_total\{to="open"\} (\d+)/m);
  const toClosed = (t: string) => metric(t, /^lca_circuit_transitions_total\{to="closed"\} (\d+)/m);

  it("opens after the failure threshold, then skips the open provider and falls back to a healthy one", async () => {
    vi.spyOn(cheap, "execute").mockImplementation(async () => failUpstream("mock-cheap", "mock-cheap:small", PRICING));

    // Two requests each record one availability failure on mock-cheap (chosen),
    // then fall back to mock-fast and succeed.
    const r1 = await complete();
    expect(r1.status).toBe(200);
    expect(r1.body.providerId).toBe("mock-fast");
    const r2 = await complete();
    expect(r2.status).toBe(200);
    expect(breaker.getState("mock-cheap")).toBe("open");

    // Third request: mock-cheap is OPEN → skipped without execution; fast serves.
    const cheapSpy = vi.spyOn(cheap, "execute");
    const before = await scrape();
    const r3 = await complete();
    const after = await scrape();

    expect(r3.status).toBe(200);
    expect(r3.body.providerId).toBe("mock-fast");
    expect(cheapSpy).not.toHaveBeenCalled(); // open circuit = no execution
    expect(fast.execute).toBeDefined();
    expect(blocked(after) - blocked(before)).toBe(1);
    expect(openGauge(after)).toBe(1);
    expect(toOpen(after)).toBeGreaterThanOrEqual(1);
    // Each HTTP call is exactly one logical request.
    expect(reqSuccess(after) - reqSuccess(before)).toBe(1);
  });

  it("returns the existing fallback error when all candidates are open", async () => {
    vi.spyOn(cheap, "execute").mockImplementation(async () => failUpstream("mock-cheap", "mock-cheap:small", PRICING));
    vi.spyOn(fast, "execute").mockImplementation(async () => failUpstream("mock-fast", "mock-fast:default", PRICING));
    // Open both providers (threshold 2 each): chosen cheap fails, fallback fast fails.
    await complete();
    await complete();
    expect(breaker.getState("mock-cheap")).toBe("open");
    expect(breaker.getState("mock-fast")).toBe("open");

    const cheapSpy = vi.spyOn(cheap, "execute");
    const fastSpy = vi.spyOn(fast, "execute");
    const res = await complete();
    expect(res.status).toBe(502); // terminal_fallback_exhausted, existing contract
    expect(cheapSpy).not.toHaveBeenCalled();
    expect(fastSpy).not.toHaveBeenCalled();
  });

  it("allows exactly one half-open probe after cooldown and closes on success", async () => {
    vi.spyOn(cheap, "execute").mockImplementation(async () => failUpstream("mock-cheap", "mock-cheap:small", PRICING));
    await complete();
    await complete();
    expect(breaker.getState("mock-cheap")).toBe("open");

    // Cooldown elapses; restore cheap so the probe succeeds.
    clock.t += COOLDOWN;
    vi.restoreAllMocks();
    const cheapSpy = vi.spyOn(cheap, "execute");

    const res = await complete();
    expect(res.status).toBe(200);
    expect(res.body.providerId).toBe("mock-cheap"); // probe executed on cheap and recovered
    expect(cheapSpy).toHaveBeenCalledTimes(1);
    expect(breaker.getState("mock-cheap")).toBe("closed");
    const t = await scrape();
    expect(openGauge(t)).toBe(0);
    expect(toClosed(t)).toBeGreaterThanOrEqual(1);
  });

  it("reopens when the half-open probe fails", async () => {
    vi.spyOn(cheap, "execute").mockImplementation(async () => failUpstream("mock-cheap", "mock-cheap:small", PRICING));
    await complete();
    await complete();
    expect(breaker.getState("mock-cheap")).toBe("open");

    clock.t += COOLDOWN; // allow a probe, but cheap still fails
    const res = await complete();
    expect(res.status).toBe(200); // probe fails on cheap, falls back to fast
    expect(res.body.providerId).toBe("mock-fast");
    expect(breaker.getState("mock-cheap")).toBe("open"); // reopened
  });

  it("grants the half-open probe to exactly one of many concurrent requests", async () => {
    vi.spyOn(cheap, "execute").mockImplementation(async () => failUpstream("mock-cheap", "mock-cheap:small", PRICING));
    await complete();
    await complete();
    expect(breaker.getState("mock-cheap")).toBe("open");

    clock.t += COOLDOWN;
    vi.restoreAllMocks();
    // The probe blocks on a manually-released gate so the circuit stays HALF_OPEN
    // (probe in flight) while every peer request checks the gate.
    const orig = cheap.execute.bind(cheap);
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    let cheapCalls = 0;
    vi.spyOn(cheap, "execute").mockImplementation(async (input, signal) => {
      cheapCalls += 1;
      await gate;
      return orig(input, signal);
    });

    // Start the single probe request and wait until it is actually in-flight on
    // mock-cheap, so peers are guaranteed to observe HALF_OPEN with a probe held.
    // (.then dispatches the supertest request immediately.)
    const probeReq = complete().then((r) => r);
    await vi.waitFor(() => expect(cheapCalls).toBe(1), { timeout: 2_000 });

    // Peers fired while the probe is in-flight must all skip to mock-fast.
    const peers = await Promise.all(Array.from({ length: 7 }, () => complete()));
    expect(peers.every((r) => r.status === 200)).toBe(true);
    expect(peers.every((r) => r.body.providerId === "mock-fast")).toBe(true);
    expect(cheapCalls).toBe(1); // no duplicate probe

    release();
    expect((await probeReq).status).toBe(200);
    expect(cheapCalls).toBe(1);
  });

  it("never touches circuit state for a budget-blocked request (no provider execution)", async () => {
    vi.spyOn(cheap, "execute").mockImplementation(async () => failUpstream("mock-cheap", "mock-cheap:small", PRICING));
    await complete();
    await complete();
    expect(breaker.getState("mock-cheap")).toBe("open");

    // Now block via budget; no provider should be touched.
    await db.insertInto("telemetry_events").values(spendRow("5.000000")).execute();
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "1.000000", action: "block" });
    const cheapSpy = vi.spyOn(cheap, "execute");
    const fastSpy = vi.spyOn(fast, "execute");

    const before = await scrape();
    const res = await complete();
    const after = await scrape();

    expect(res.status).toBe(429);
    expect(cheapSpy).not.toHaveBeenCalled();
    expect(fastSpy).not.toHaveBeenCalled();
    expect(blocked(after) - blocked(before)).toBe(0); // budget block is not a circuit skip
    expect(breaker.getState("mock-cheap")).toBe("open"); // unchanged
    expect(breaker.getState("mock-fast")).toBe("closed"); // unchanged
  });
});
