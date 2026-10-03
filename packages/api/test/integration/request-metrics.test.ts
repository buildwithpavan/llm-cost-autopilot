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
import { armMockFailure, createMockAdapter, createRegistry } from "@lca/providers";

import { buildServer } from "../../src/server.js";
import { loadConfig } from "../../src/config.js";
import { createMetrics, type Metrics } from "../../src/plugins/metrics.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

const CLIENT = "req-metrics";
const PRICING = "req-metrics-pricing";

gated("request-level Prometheus metrics (completion lifecycle)", () => {
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
    const config = loadConfig({ ...process.env, DATABASE_URL });
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

  function complete(payload: unknown) {
    return supertest(app.server)
      .post("/v1/completions")
      .set("authorization", `Bearer ${secret}`)
      .send(payload);
  }

  async function scrape(): Promise<string> {
    const res = await supertest(app.server).get("/metrics");
    expect(res.status).toBe(200);
    return res.text;
  }

  function reqCount(text: string, outcome: string): number {
    const m = new RegExp(`^lca_requests_total\\{outcome="${outcome}"\\} (\\d+(?:\\.\\d+)?)`, "m").exec(text);
    return m ? Number(m[1]) : 0;
  }
  function histCount(text: string, name: string): number {
    const m = new RegExp(`^${name}_count (\\d+(?:\\.\\d+)?)`, "m").exec(text);
    return m ? Number(m[1]) : 0;
  }

  it("counts a successful completion and observes duration + routing overhead", async () => {
    const before = await scrape();
    const res = await complete(msg);
    expect(res.status).toBe(200);
    const after = await scrape();

    expect(reqCount(after, "success") - reqCount(before, "success")).toBe(1);
    expect(histCount(after, "lca_request_duration_seconds") - histCount(before, "lca_request_duration_seconds")).toBe(1);
    expect(histCount(after, "lca_routing_overhead_ms") - histCount(before, "lca_routing_overhead_ms")).toBe(1);
  });

  it("counts a budget block as budget_blocked, observes duration + overhead, and never executes a provider", async () => {
    await db.insertInto("telemetry_events").values(spendRow("5.000000")).execute();
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "1.000000", action: "block" });
    const cheapSpy = vi.spyOn(cheap, "execute");
    const fastSpy = vi.spyOn(fast, "execute");

    const before = await scrape();
    const res = await complete(msg);
    expect(res.status).toBe(429);
    const after = await scrape();

    expect(reqCount(after, "budget_blocked") - reqCount(before, "budget_blocked")).toBe(1);
    expect(histCount(after, "lca_request_duration_seconds") - histCount(before, "lca_request_duration_seconds")).toBe(1);
    // Decision was finalized before budget evaluation, so overhead is observed.
    expect(histCount(after, "lca_routing_overhead_ms") - histCount(before, "lca_routing_overhead_ms")).toBe(1);
    expect(cheapSpy).not.toHaveBeenCalled();
    expect(fastSpy).not.toHaveBeenCalled();
  });

  it("counts fallback exhaustion once (not per attempt) as provider_error", async () => {
    // Force every attempt on either provider to fail transiently so the fallback
    // chain is exhausted (re-arm before each execute since arming is single-shot).
    const origCheap = cheap.execute.bind(cheap);
    const origFast = fast.execute.bind(fast);
    const cheapSpy = vi.spyOn(cheap, "execute").mockImplementation(async (input, signal) => {
      armMockFailure(cheap, "upstream_5xx");
      return origCheap(input, signal);
    });
    const fastSpy = vi.spyOn(fast, "execute").mockImplementation(async (input, signal) => {
      armMockFailure(fast, "upstream_5xx");
      return origFast(input, signal);
    });

    const before = await scrape();
    const res = await complete(msg);
    expect(res.status).toBe(502);
    const after = await scrape();

    // Multiple execution attempts happened...
    expect(cheapSpy.mock.calls.length + fastSpy.mock.calls.length).toBeGreaterThan(1);
    // ...but the request is counted exactly once.
    expect(reqCount(after, "provider_error") - reqCount(before, "provider_error")).toBe(1);
    expect(histCount(after, "lca_request_duration_seconds") - histCount(before, "lca_request_duration_seconds")).toBe(1);
  });

  it("counts a pre-routing validation failure as client_error without routing overhead", async () => {
    const before = await scrape();
    const res = await complete({ messages: [] }); // fails schema validation
    expect(res.status).toBe(400);
    const after = await scrape();

    expect(reqCount(after, "client_error") - reqCount(before, "client_error")).toBe(1);
    expect(histCount(after, "lca_request_duration_seconds") - histCount(before, "lca_request_duration_seconds")).toBe(1);
    // No routing decision was finalized → no overhead observation.
    expect(histCount(after, "lca_routing_overhead_ms") - histCount(before, "lca_routing_overhead_ms")).toBe(0);
  });

  it("exposes only the bounded outcome label (no high-cardinality identifiers)", async () => {
    await complete(msg);
    const text = await scrape();
    const lines = text.split("\n").filter((l) => l.startsWith("lca_requests_total{"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const labels = line.slice(line.indexOf("{") + 1, line.indexOf("}"));
      // The ONLY label is a bounded outcome enum — no high-cardinality identifiers.
      expect(labels).toMatch(/^outcome="(success|client_error|provider_error|budget_blocked|internal_error)"$/);
      expect(labels).not.toMatch(/client_id|request_id|provider_id|model_id|_id=|api_key/);
    }
    // Duration and overhead carry no labels at all.
    expect(text).toMatch(/^lca_request_duration_seconds_count \d/m);
    expect(text).toMatch(/^lca_routing_overhead_ms_count \d/m);
  });
});
