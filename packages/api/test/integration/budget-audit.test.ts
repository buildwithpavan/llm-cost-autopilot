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

const CLIENT = "budaudit";
const PRICING = "budaudit-pricing";

gated("budget decision auditability", () => {
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
    await db.deleteFrom("budget_decisions").where("client_id", "=", CLIENT).execute();
    await db.deleteFrom("spend_budgets").execute();
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db.insertInto("pricing_tables").values({ version_id: PRICING, effective_from: new Date(), is_active: false }).execute();
    await setProviderHealth(db, "mock-cheap", true, 0);
    await setProviderHealth(db, "mock-fast", true, 0);

    const registry = createRegistry();
    cheap = createMockAdapter({ providerId: "mock-cheap" });
    fast = createMockAdapter({ providerId: "mock-fast" });
    registry.register(cheap);
    registry.register(fast);

    secret = (await createApiKey(db, { clientId: CLIENT, label: CLIENT })).secret;
    ruleStore = createOperatorRuleStore(db);
    budgetStore = createBudgetStore(db);
    writer = createTelemetryWriter(db, { batchSize: 1, flushEveryMs: 0 });
    app = await buildServer({ config: loadConfig({ ...process.env, DATABASE_URL }), db, registry, telemetryWriter: writer, ruleStore, budgetStore });
    await app.ready();
  });

  afterAll(async () => {
    await writer.close();
    await app.close();
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();
    await db.deleteFrom("budget_decisions").where("client_id", "=", CLIENT).execute();
    await db.deleteFrom("spend_budgets").execute();
    await db.deleteFrom("api_keys").where("label", "=", CLIENT).execute();
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db.destroy();
  });

  beforeEach(async () => {
    await db.deleteFrom("spend_budgets").execute();
    budgetStore.invalidate();
    await db.deleteFrom("operator_rules").execute();
    ruleStore.invalidate();
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();
    await db.deleteFrom("budget_decisions").where("client_id", "=", CLIENT).execute();
  });

  afterEach(() => vi.restoreAllMocks());

  const msg = { messages: [{ role: "user", content: "hi" }] };
  function complete(cid?: string, payload: unknown = msg) {
    const r = supertest(app.server).post("/v1/completions").set("authorization", `Bearer ${secret}`);
    if (cid) r.set("x-request-id", cid);
    return r.send(payload);
  }
  const listDecisions = () =>
    supertest(app.server).get(`/v1/telemetry/budget-decisions?clientId=${CLIENT}`).set("authorization", `Bearer ${secret}`);
  const countEvents = async () =>
    Number(
      (
        (await db.selectFrom("telemetry_events").select(db.fn.count("event_id").as("c")).where("client_id", "=", CLIENT).executeTakeFirst()) as {
          c: string;
        }
      ).c,
    );

  it("persists a durable audit record for a block and emits budget.evaluated, with no provider execution", async () => {
    await db.insertInto("telemetry_events").values(spendRow("1.000000")).execute();
    const b = await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "0.500000", action: "block" });

    const cheapExec = vi.spyOn(cheap, "execute");
    const fastExec = vi.spyOn(fast, "execute");
    const cid = randomUUID();
    const seen: Array<{ eventType: string; seq: number; decision?: string; blockedBudgetIds?: string[] }> = [];
    const unsub = sharedStreamBus.subscribe((e) => {
      if ((e as { eventId?: string }).eventId === cid) seen.push(e as never);
    });
    const before = await countEvents();

    let res;
    try {
      res = await complete(cid);
    } finally {
      unsub();
    }

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("budget_exceeded");

    // Stream: budget.evaluated(blocked), governance.completed present; NO execution / decision.committed.
    const be = seen.find((e) => e.eventType === "budget.evaluated");
    expect(be).toBeTruthy();
    expect(be!.decision).toBe("blocked");
    expect(be!.blockedBudgetIds).toEqual([b.budgetId]);
    expect(seen.some((e) => e.eventType === "governance.completed")).toBe(true);
    expect(seen.some((e) => e.eventType === "execution.started")).toBe(false);
    expect(seen.some((e) => e.eventType === "decision.committed")).toBe(false);
    expect(cheapExec).not.toHaveBeenCalled();
    expect(fastExec).not.toHaveBeenCalled();

    // Durable: a budget_decision row exists; NO completion telemetry row.
    const dec = await listDecisions();
    const row = dec.body.decisions.find((d: { eventId: string }) => d.eventId === cid);
    expect(row).toBeTruthy();
    expect(row.decision).toBe("blocked");
    expect(row.blockedBudgetIds).toEqual([b.budgetId]);
    expect(row.requestEstimatedCostUsd).toMatch(/^\d+(\.\d+)?$/);
    expect(row.evaluations[0].limitUsd).toBe("0.500000");
    expect(row.evaluations[0].currentSpendUsd).toBe("1.000000");
    await new Promise((r) => setTimeout(r, 80));
    expect(await countEvents()).toBe(before); // no provider/completion telemetry
  });

  it("budget.evaluated(blocked) precedes any execution attempt (ordering)", async () => {
    await db.insertInto("telemetry_events").values(spendRow("1.000000")).execute();
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "0.500000", action: "block" });
    const cid = randomUUID();
    const order: string[] = [];
    const unsub = sharedStreamBus.subscribe((e) => {
      if ((e as { eventId?: string }).eventId === cid) order.push(e.eventType);
    });
    try {
      await complete(cid);
    } finally {
      unsub();
    }
    expect(order).toContain("budget.evaluated");
    // No execution event at all for a block.
    expect(order.filter((t) => t.startsWith("execution.")).length).toBe(0);
  });

  it("records a warned audit before provider execution and still completes", async () => {
    await db.insertInto("telemetry_events").values(spendRow("1.000000")).execute();
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "0.500000", action: "warn" });
    const cid = randomUUID();
    const order: Array<{ t: string; seq: number }> = [];
    const unsub = sharedStreamBus.subscribe((e) => {
      if ((e as { eventId?: string }).eventId === cid) order.push({ t: e.eventType, seq: (e as { seq: number }).seq });
    });
    let res;
    try {
      res = await complete(cid);
    } finally {
      unsub();
    }
    expect(res.status).toBe(200);
    const budgetSeq = order.find((o) => o.t === "budget.evaluated")?.seq ?? Infinity;
    const execSeq = order.find((o) => o.t === "execution.started")?.seq ?? -1;
    expect(budgetSeq).toBeLessThan(execSeq); // warning observed before execution

    const dec = await listDecisions();
    const row = dec.body.decisions.find((d: { eventId: string }) => d.eventId === cid);
    expect(row.decision).toBe("warned");
  });

  it("does not record an audit for an allowed request or a no-budget request", async () => {
    // allowed (budget applies but under limit)
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "1000", action: "block" });
    const cidA = randomUUID();
    expect((await complete(cidA)).status).toBe(200);

    // no budget
    await db.deleteFrom("spend_budgets").execute();
    budgetStore.invalidate();
    const cidN = randomUUID();
    expect((await complete(cidN)).status).toBe(200);

    const rows = (await listDecisions()).body.decisions as Array<{ eventId: string }>;
    expect(rows.some((r) => r.eventId === cidA)).toBe(false);
    expect(rows.some((r) => r.eventId === cidN)).toBe(false);
  });

  it("ignores disabled and other-client budgets (no audit)", async () => {
    await db.insertInto("telemetry_events").values(spendRow("1.000000")).execute();
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "0.500000", action: "block", enabled: false });
    await budgetStore.create({ scope: "client", clientId: "someone-else", period: "daily", limitUsd: "0.500000", action: "block" });
    const cid = randomUUID();
    expect((await complete(cid)).status).toBe(200);
    const rows = (await listDecisions()).body.decisions as Array<{ eventId: string }>;
    expect(rows.some((r) => r.eventId === cid)).toBe(false);
  });

  it("replay rejects a budget-decision event id and 404s an unknown id", async () => {
    await db.insertInto("telemetry_events").values(spendRow("1.000000")).execute();
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "0.500000", action: "block" });
    const cid = randomUUID();
    await complete(cid);

    const replay = await supertest(app.server).get(`/v1/telemetry/replay/${cid}`).set("authorization", `Bearer ${secret}`);
    expect(replay.status).toBe(422);
    expect(replay.body.error.code).toBe("not_replayable");

    const missing = await supertest(app.server)
      .get("/v1/telemetry/replay/00000000-0000-0000-0000-000000000000")
      .set("authorization", `Bearer ${secret}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("event_not_found");
  });

  it("budget-decisions read requires auth", async () => {
    expect((await supertest(app.server).get("/v1/telemetry/budget-decisions")).status).toBe(401);
  });
});
