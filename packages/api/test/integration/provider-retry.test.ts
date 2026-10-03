import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";

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

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

const CLIENT = "retry-integ";
const PRICING = "retry-integ-pricing";

gated("provider retry + timeout foundation (Phase 8)", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let secret: string;
  let writer: TelemetryWriter;
  let budgetStore: BudgetStore;
  let metrics: Metrics;
  let cheap: ReturnType<typeof createMockAdapter>;
  let fast: ReturnType<typeof createMockAdapter>;

  function spendRow(estimated: string) {
    return {
      event_id: randomUUID(),
      received_at: new Date().toISOString(),
      client_id: CLIENT,
      decision_source: "autopilot" as const,
      shadowed_source: null,
      effective_provider_id: "mock-cheap",
      effective_model_id: "mock-cheap:small",
      attempts: JSON.stringify([]),
      aggregated_input_tokens: 1,
      aggregated_output_tokens: 1,
      total_latency_ms: 1,
      terminal_error_class: "none",
      estimated_cost_usd: estimated,
      actual_cost_usd: null,
      pricing_table_version_id: PRICING,
      reconciled: null,
      routing_rationale: JSON.stringify({}),
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
    await db
      .insertInto("pricing_tables")
      .values({ version_id: PRICING, effective_from: new Date(), is_active: false })
      .execute();
    await setProviderHealth(db, "mock-cheap", true, 0);
    await setProviderHealth(db, "mock-fast", true, 0);

    const registry = createRegistry();
    cheap = createMockAdapter({ providerId: "mock-cheap" });
    fast = createMockAdapter({ providerId: "mock-fast" });
    registry.register(cheap);
    registry.register(fast);

    const created = await createApiKey(db, { clientId: CLIENT, label: CLIENT });
    secret = created.secret;

    budgetStore = createBudgetStore(db);
    writer = createTelemetryWriter(db, { batchSize: 1, flushEveryMs: 0 });
    metrics = createMetrics();
    // Retries enabled with zero backoff so the suite never sleeps for real.
    const config = loadConfig({
      ...process.env,
      DATABASE_URL,
      LCA_PROVIDER_MAX_RETRIES: "2",
      LCA_PROVIDER_RETRY_BACKOFF_MS: "0",
    });
    app = await buildServer({ config, db, registry, telemetryWriter: writer, budgetStore, metrics });
    await app.ready();
  });

  afterAll(async () => {
    await writer.close();
    await app.close();
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();
    await db.deleteFrom("spend_budgets").execute();
    await db.deleteFrom("api_keys").where("label", "=", CLIENT).execute();
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db.destroy();
  });

  beforeEach(async () => {
    await db.deleteFrom("spend_budgets").execute();
    budgetStore.invalidate();
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();
    vi.restoreAllMocks();
  });

  const msg = { messages: [{ role: "user", content: "hi" }] };

  function complete(cid?: string) {
    const r = supertest(app.server).post("/v1/completions").set("authorization", `Bearer ${secret}`);
    if (cid) r.set("x-request-id", cid);
    return r.send(msg);
  }
  async function scrape(): Promise<string> {
    const res = await supertest(app.server).get("/metrics");
    return res.text;
  }
  function reqCount(text: string, outcome: string): number {
    const m = new RegExp(`^lca_requests_total\\{outcome="${outcome}"\\} (\\d+)`, "m").exec(text);
    return m ? Number(m[1]) : 0;
  }
  function histCount(text: string, name: string): number {
    const m = new RegExp(`^${name}_count (\\d+)`, "m").exec(text);
    return m ? Number(m[1]) : 0;
  }
  async function fetchEvent(cid: string) {
    const events = await supertest(app.server)
      .get(`/v1/telemetry/events?clientId=${CLIENT}&limit=10`)
      .set("authorization", `Bearer ${secret}`);
    return events.body.events.find((e: { eventId: string }) => e.eventId === cid);
  }

  it("retries a transient provider failure on the same provider and recovers (no fallback)", async () => {
    // Chosen provider fails once transiently, then succeeds on retry.
    let n = 0;
    const orig = cheap.execute.bind(cheap);
    const cheapSpy = vi.spyOn(cheap, "execute").mockImplementation(async (input, signal) => {
      n += 1;
      if (n === 1) return { kind: "failure", attempt: { attemptIndex: 0, providerId: "mock-cheap", modelId: input.modelId, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), latencyMs: 0, inputTokens: null, outputTokens: null, errorClass: "upstream_5xx", estimatedCostUsd: "0", actualCostUsd: null, pricingTableVersionId: input.pricingTable.versionId } };
      return orig(input, signal);
    });
    const fastSpy = vi.spyOn(fast, "execute");

    const cid = randomUUID();
    const before = await scrape();
    const res = await complete(cid);
    const after = await scrape();

    expect(res.status).toBe(200);
    // The chosen provider served the request after retrying; no fallback occurred.
    expect(res.body.providerId).toBe("mock-cheap");
    expect(res.body.modelId).toBe(res.body.decision.chosenModelId);
    expect(cheapSpy).toHaveBeenCalledTimes(2);
    expect(fastSpy).not.toHaveBeenCalled();

    await new Promise((r) => setTimeout(r, 80));
    const ev = await fetchEvent(cid);
    // Retries collapse into the single candidate attempt (telemetry attempts <= 2).
    expect(ev.attempts).toHaveLength(1);
    expect(ev.attempts[0].errorClass).toBe("none");
    expect(ev.terminalErrorClass).toBe("none");

    // Exactly one logical request + one duration observation despite the retry.
    expect(reqCount(after, "success") - reqCount(before, "success")).toBe(1);
    expect(histCount(after, "lca_request_duration_seconds") - histCount(before, "lca_request_duration_seconds")).toBe(1);
  });

  it("after retry exhaustion, falls back to the next provider; order unchanged", async () => {
    // The chosen candidate (first model seen) fails transiently on every attempt;
    // the next fallback candidate (a different model) succeeds.
    let chosenModel: string | null = null;
    let chosenAttempts = 0;
    const origCheap = cheap.execute.bind(cheap);
    const origFast = fast.execute.bind(fast);
    const wrap = (orig: typeof origCheap, providerId: string) =>
      async (input: Parameters<typeof origCheap>[0], signal: Parameters<typeof origCheap>[1]) => {
        if (chosenModel === null) chosenModel = input.modelId;
        if (input.modelId === chosenModel) {
          chosenAttempts += 1;
          return {
            kind: "failure" as const,
            attempt: { attemptIndex: 0, providerId, modelId: input.modelId, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), latencyMs: 0, inputTokens: null, outputTokens: null, errorClass: "upstream_5xx" as const, estimatedCostUsd: "0", actualCostUsd: null, pricingTableVersionId: input.pricingTable.versionId },
          };
        }
        return orig(input, signal);
      };
    vi.spyOn(cheap, "execute").mockImplementation(wrap(origCheap, "mock-cheap"));
    vi.spyOn(fast, "execute").mockImplementation(wrap(origFast, "mock-fast"));

    const cid = randomUUID();
    const res = await complete(cid);
    expect(res.status).toBe(200);
    // Chosen candidate was attempted maxRetries+1 = 3 times before fallback.
    expect(chosenAttempts).toBe(3);

    await new Promise((r) => setTimeout(r, 80));
    const ev = await fetchEvent(cid);
    expect(ev.attempts).toHaveLength(2); // one per fallback candidate, not per retry
    expect(ev.attempts[0].errorClass).toBe("upstream_5xx");
    expect(ev.attempts[0].modelId).toBe(chosenModel);
    expect(ev.attempts[1].errorClass).toBe("none");
    expect(ev.attempts[1].modelId).not.toBe(chosenModel);
    expect(ev.terminalErrorClass).toBe("none");
  });

  it("never enters provider retry logic for a budget-blocked request", async () => {
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
    expect(reqCount(after, "budget_blocked") - reqCount(before, "budget_blocked")).toBe(1);
  });
});
