import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

const CLIENT = "opt-insights-integ";
// Relies on the seeded active pricing table (seed-2026-09-08) that prices the
// mock catalog: mock-fast:default (expensive) and mock-cheap:small (cheap).
const PRICING = "seed-2026-09-08";

function evRow(o: {
  providerId: string;
  modelId: string;
  estimated: string;
  inputTokens: number;
  outputTokens: number;
}) {
  return {
    event_id: randomUUID(),
    received_at: new Date().toISOString(),
    client_id: CLIENT,
    decision_source: "autopilot" as const,
    shadowed_source: null,
    effective_provider_id: o.providerId,
    effective_model_id: o.modelId,
    attempts: JSON.stringify([]),
    aggregated_input_tokens: o.inputTokens,
    aggregated_output_tokens: o.outputTokens,
    total_latency_ms: 100,
    terminal_error_class: "none",
    estimated_cost_usd: o.estimated,
    actual_cost_usd: null,
    pricing_table_version_id: PRICING,
    reconciled: null,
    routing_rationale: JSON.stringify({}),
  };
}

gated("contract: GET /v1/telemetry/optimization-insights (Phase 15)", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let secret: string;
  let writer: TelemetryWriter;
  let budgetStore: BudgetStore;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
    await db.deleteFrom("api_keys").where("label", "=", CLIENT).execute();
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();
    await db.deleteFrom("spend_budgets").execute();
    await setProviderHealth(db, "mock-cheap", true, 0);
    await setProviderHealth(db, "mock-fast", true, 0);

    // 3 expensive requests to mock-fast:default (3000 in / 1500 out aggregated):
    //   priced under seed pricing: 3000*1e-6 + 1500*2e-6 = 0.006 ... scaled ×100.
    await db
      .insertInto("telemetry_events")
      .values([
        evRow({ providerId: "mock-fast", modelId: "mock-fast:default", estimated: "0.200000", inputTokens: 100_000, outputTokens: 50_000 }),
        evRow({ providerId: "mock-fast", modelId: "mock-fast:default", estimated: "0.200000", inputTokens: 100_000, outputTokens: 50_000 }),
        evRow({ providerId: "mock-fast", modelId: "mock-fast:default", estimated: "0.200000", inputTokens: 100_000, outputTokens: 50_000 }),
        // one small cheap request (below the min-spend floor → not surfaced alone).
        evRow({ providerId: "mock-cheap", modelId: "mock-cheap:small", estimated: "0.000300", inputTokens: 1_000, outputTokens: 500 }),
      ])
      .execute();

    const registry = createRegistry();
    registry.register(createMockAdapter({ providerId: "mock-cheap" }));
    registry.register(createMockAdapter({ providerId: "mock-fast" }));
    const created = await createApiKey(db, { clientId: CLIENT, label: CLIENT });
    secret = created.secret;

    budgetStore = createBudgetStore(db);
    writer = createTelemetryWriter(db, { batchSize: 1, flushEveryMs: 0 });
    const config = loadConfig({ ...process.env, DATABASE_URL });
    app = await buildServer({ config, db, registry, telemetryWriter: writer, budgetStore });
    await app.ready();
  });

  afterAll(async () => {
    await writer.close();
    await app.close();
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();
    await db.deleteFrom("spend_budgets").execute();
    await db.deleteFrom("api_keys").where("label", "=", CLIENT).execute();
    await db.destroy();
  });

  beforeEach(async () => {
    await db.deleteFrom("spend_budgets").execute();
    budgetStore.invalidate();
  });

  function get(path: string) {
    return supertest(app.server).get(path).set("authorization", `Bearer ${secret}`);
  }

  it("returns 401 without a Bearer token", async () => {
    const res = await supertest(app.server).get("/v1/telemetry/optimization-insights");
    expect(res.status).toBe(401);
  });

  it("returns the advisory contract: window, thresholds, pricing version, deterministic insights", async () => {
    const res = await get(`/v1/telemetry/optimization-insights?clientId=${CLIENT}`);
    expect(res.status).toBe(200);
    expect(res.body.window).toHaveProperty("since");
    expect(res.body.window).toHaveProperty("until");
    expect(res.body.thresholds).toHaveProperty("concentrationRatioThreshold");
    expect(res.body.pricingTableVersionId).toBe(PRICING);
    expect(Array.isArray(res.body.insights)).toBe(true);

    const conc = res.body.insights.find(
      (i: { type: string; modelId?: string }) => i.type === "cost_concentration" && i.modelId === "mock-fast:default",
    );
    expect(conc).toBeDefined();
    expect(typeof conc.shareRatio).toBe("string");
    expect(conc.shareRatio).toBe("0.999500"); // 0.600000 / 0.600300, exact
    expect(conc.estimatedCostUsd).toBe("0.600000");
    expect(conc.severity).toBe("warning");

    const pricing = res.body.insights.find(
      (i: { type: string; providerId?: string }) => i.type === "pricing_comparison" && i.providerId === "mock-fast",
    );
    expect(pricing).toBeDefined();
    expect(pricing.alternativeProviderId).toBe("mock-cheap");
    expect(pricing.alternativeModelId).toBe("mock-cheap:small");
    expect(pricing.currentPricedCostUsd).toBe("0.6");
    expect(pricing.counterfactualEstimatedCostUsd).toBe("0.06");
    expect(pricing.costDifferenceUsd).toBe("0.54"); // exact decimal difference
    expect(pricing.compatibilitySignal).toBe("none"); // mock-cheap:small lacks function_calling
    expect(pricing.severity).toBe("info");
    // Never an imperative routing directive; always labelled advisory.
    const text = `${pricing.title} ${pricing.description}`.toLowerCase();
    for (const w of ["switch", "replace", "you should", "best", "optimal"]) {
      expect(text).not.toContain(w);
    }
    expect(pricing.assumptions.some((a: string) => a.includes("not a routing"))).toBe(true);
  });

  it("surfaces budget pressure (critical) from the existing budget-status semantics, ordered first", async () => {
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "0.100000", action: "block" });
    const res = await get(`/v1/telemetry/optimization-insights?clientId=${CLIENT}`);
    expect(res.status).toBe(200);
    const budget = res.body.insights.find((i: { type: string }) => i.type === "budget_pressure");
    expect(budget).toBeDefined();
    expect(budget.status).toBe("over_limit");
    expect(budget.severity).toBe("critical");
    expect(budget.currentSpendUsd).toBe("0.600300"); // exact spend, decimal string
    // Deterministic ordering: critical budget pressure sorts ahead of warnings/info.
    expect(res.body.insights[0].type).toBe("budget_pressure");
    expect(res.body.insights[0].severity).toBe("critical");
  });

  it("applies the providerId filter to concentration/pricing (telemetry-scoped)", async () => {
    const res = await get(`/v1/telemetry/optimization-insights?clientId=${CLIENT}&providerId=mock-cheap`);
    expect(res.status).toBe(200);
    // Only the tiny cheap model remains, below the min-spend floor → no price/concentration insights.
    expect(res.body.insights.filter((i: { type: string }) => i.type === "cost_concentration")).toHaveLength(0);
    expect(res.body.insights.filter((i: { type: string }) => i.type === "pricing_comparison")).toHaveLength(0);
  });

  it("returns an empty insight list for a window with no spend and no budgets", async () => {
    const since = new Date("2026-09-02T00:00:00.000Z").toISOString();
    const until = new Date("2026-09-03T00:00:00.000Z").toISOString();
    const res = await get(`/v1/telemetry/optimization-insights?clientId=${CLIENT}&since=${since}&until=${until}`);
    expect(res.status).toBe(200);
    expect(res.body.insights).toEqual([]);
  });

  it("is deterministic across repeated calls and mutates nothing", async () => {
    const before = await db.selectFrom("telemetry_events").where("client_id", "=", CLIENT).select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow();
    const a = await get(`/v1/telemetry/optimization-insights?clientId=${CLIENT}`);
    const b = await get(`/v1/telemetry/optimization-insights?clientId=${CLIENT}`);
    expect(a.body.insights).toEqual(b.body.insights);
    const after = await db.selectFrom("telemetry_events").where("client_id", "=", CLIENT).select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n); // no telemetry writes
  });

  it("rejects an invalid date and an over-long window", async () => {
    const bad = await get("/v1/telemetry/optimization-insights?since=not-a-date");
    expect(bad.status).toBe(400);
    const since = new Date("2026-08-01T00:00:00.000Z").toISOString();
    const until = new Date("2026-10-01T00:00:00.000Z").toISOString();
    const wide = await get(`/v1/telemetry/optimization-insights?since=${since}&until=${until}`);
    expect(wide.status).toBe(400);
  });
});
