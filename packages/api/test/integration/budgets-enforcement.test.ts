import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";

import {
  createApiKey,
  createBudgetStore,
  createDb,
  createOperatorRuleStore,
  createPool,
  createTelemetryWriter,
  runMigrations,
  setProviderHealth,
  type BudgetStore,
  type Db,
  type OperatorRuleStore,
  type TelemetryWriter,
} from "@lca/persistence";
import { createMockAdapter, createRegistry } from "@lca/providers";

import { buildServer } from "../../src/server.js";
import { loadConfig } from "../../src/config.js";
import { sharedStreamBus } from "../../src/plugins/stream-bus.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

const CLIENT = "bud-enf";
const PRICING = "bud-enf-pricing";

gated("budget enforcement (completion + preview)", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let secret: string;
  let writer: TelemetryWriter;
  let ruleStore: OperatorRuleStore;
  let budgetStore: BudgetStore;
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
      actual_cost_usd: null, // actual is null → proves enforcement uses estimated
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

    ruleStore = createOperatorRuleStore(db);
    budgetStore = createBudgetStore(db);
    writer = createTelemetryWriter(db, { batchSize: 1, flushEveryMs: 0 });
    const config = loadConfig({ ...process.env, DATABASE_URL });
    app = await buildServer({ config, db, registry, telemetryWriter: writer, ruleStore, budgetStore });
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
  });

  afterEach(() => vi.restoreAllMocks());

  function complete(payload: unknown, cid?: string) {
    const r = supertest(app.server).post("/v1/completions").set("authorization", `Bearer ${secret}`);
    if (cid) r.set("x-request-id", cid);
    return r.send(payload);
  }
  function preview(payload: unknown) {
    return supertest(app.server)
      .post("/v1/routing/preview")
      .set("authorization", `Bearer ${secret}`)
      .send(payload);
  }
  const msg = { messages: [{ role: "user", content: "hi" }] };

  it("allows and executes normally when under budget", async () => {
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "100", action: "block" });
    const res = await complete(msg);
    expect(res.status).toBe(200);
    expect(res.body.providerId).toBeTruthy();
  });

  it("warns but executes normally, recording a budget rationale", async () => {
    await db.insertInto("telemetry_events").values(spendRow("1.000000")).execute();
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "0.500000", action: "warn" });
    const res = await complete(msg);
    expect(res.status).toBe(200);
    const budgetRationale = res.body.decision.rationale.find((r: { factor: string }) => r.factor === "budget");
    expect(budgetRationale).toBeTruthy();
    expect(budgetRationale.note).toMatch(/warn/i);
  });

  it("blocks with 429 budget_exceeded and never invokes a provider or fallback", async () => {
    await db.insertInto("telemetry_events").values(spendRow("1.000000")).execute();
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "0.500000", action: "block" });

    const cheapExec = vi.spyOn(cheap, "execute");
    const fastExec = vi.spyOn(fast, "execute");
    const cid = randomUUID();
    const seen: string[] = [];
    const unsub = sharedStreamBus.subscribe((e) => {
      if ((e as { eventId?: string }).eventId === cid) seen.push(e.eventType);
    });

    const before = await db
      .selectFrom("telemetry_events")
      .select(db.fn.count("event_id").as("c"))
      .where("client_id", "=", CLIENT)
      .executeTakeFirst();

    let res;
    try {
      res = await complete(msg, cid);
    } finally {
      unsub();
    }

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("budget_exceeded");
    expect(Array.isArray(res.body.error.details.blockedBudgetIds)).toBe(true);
    expect(res.body.error.details.blockedBudgetIds.length).toBe(1);
    expect(res.body.error.details.budgets[0]).toHaveProperty("limitUsd");

    // No provider call, no fallback.
    expect(cheapExec).not.toHaveBeenCalled();
    expect(fastExec).not.toHaveBeenCalled();

    // Governance decided, but nothing was executed/committed.
    expect(seen).toContain("governance.completed");
    expect(seen).not.toContain("execution.started");
    expect(seen).not.toContain("execution.completed");
    expect(seen).not.toContain("decision.committed");

    // No completion telemetry written for the blocked request.
    await new Promise((r) => setTimeout(r, 100));
    const after = await db
      .selectFrom("telemetry_events")
      .select(db.fn.count("event_id").as("c"))
      .where("client_id", "=", CLIENT)
      .executeTakeFirst();
    expect(Number((after as { c: string }).c)).toBe(Number((before as { c: string }).c));
  });

  it("combines multiple applicable budgets (client block wins over global warn)", async () => {
    await db.insertInto("telemetry_events").values(spendRow("1.000000")).execute();
    await budgetStore.create({ scope: "global", period: "daily", limitUsd: "1000", action: "warn" });
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "0.500000", action: "block" });
    const res = await complete(msg);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("budget_exceeded");
  });

  it("ignores disabled budgets", async () => {
    await db.insertInto("telemetry_events").values(spendRow("1.000000")).execute();
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "0.500000", action: "block", enabled: false });
    const res = await complete(msg);
    expect(res.status).toBe(200);
  });

  it("ignores another client's budget", async () => {
    await db.insertInto("telemetry_events").values(spendRow("1.000000")).execute();
    await budgetStore.create({ scope: "client", clientId: "someone-else", period: "daily", limitUsd: "0.500000", action: "block" });
    const res = await complete(msg);
    expect(res.status).toBe(200);
  });

  it("leaves no-budget requests behaviorally unchanged", async () => {
    const res = await complete(msg);
    expect(res.status).toBe(200);
    expect(res.body.decision.rationale.some((r: { factor: string }) => r.factor === "budget")).toBe(false);
  });

  // ---- preview simulation + parity ------------------------------------

  it("preview reports a hypothetical block without 429 or side effects", async () => {
    await db.insertInto("telemetry_events").values(spendRow("1.000000")).execute();
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "0.500000", action: "block" });

    const cheapExec = vi.spyOn(cheap, "execute");
    const before = await db
      .selectFrom("telemetry_events")
      .select(db.fn.count("event_id").as("c"))
      .where("client_id", "=", CLIENT)
      .executeTakeFirst();

    const res = await preview(msg);
    expect(res.status).toBe(200);
    expect(res.body.budget.decision).toBe("blocked");
    expect(res.body.chosenProviderId).toBeTruthy(); // decision still present
    expect(cheapExec).not.toHaveBeenCalled();

    await new Promise((r) => setTimeout(r, 50));
    const after = await db
      .selectFrom("telemetry_events")
      .select(db.fn.count("event_id").as("c"))
      .where("client_id", "=", CLIENT)
      .executeTakeFirst();
    expect(Number((after as { c: string }).c)).toBe(Number((before as { c: string }).c));
  });

  it("preview reports hypothetical warn and allowed", async () => {
    await db.insertInto("telemetry_events").values(spendRow("1.000000")).execute();
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "0.500000", action: "warn" });
    expect((await preview(msg)).body.budget.decision).toBe("warned");

    await db.deleteFrom("spend_budgets").execute();
    budgetStore.invalidate();
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "1000", action: "block" });
    expect((await preview(msg)).body.budget.decision).toBe("allowed");
  });

  it("preview and completion produce the same budget decision for identical conditions", async () => {
    await db.insertInto("telemetry_events").values(spendRow("1.000000")).execute();
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "0.500000", action: "block" });

    const prev = await preview(msg);
    const comp = await complete(msg);
    expect(prev.body.budget.decision).toBe("blocked");
    expect(comp.status).toBe(429); // completion enforces what preview simulated
    expect(comp.body.error.code).toBe("budget_exceeded");
  });
});
