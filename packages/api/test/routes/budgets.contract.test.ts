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
  type BudgetStore,
  type Db,
  type TelemetryWriter,
} from "@lca/persistence";
import { createMockAdapter, createRegistry } from "@lca/providers";

import { buildServer } from "../../src/server.js";
import { loadConfig } from "../../src/config.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

const CLIENT = "budget-api";
const PRICING = "budget-api-pricing";

gated("contract: /v1/budgets", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let secret: string;
  let writer: TelemetryWriter;
  let budgetStore: BudgetStore;

  function spendRow(estimated: string, receivedAt: Date) {
    return {
      event_id: randomUUID(),
      received_at: receivedAt.toISOString(),
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

  const auth = () => ({ authorization: `Bearer ${secret}` });

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

    const registry = createRegistry();
    registry.register(createMockAdapter({ providerId: "mock-cheap" }));
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
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db.destroy();
  });

  beforeEach(async () => {
    await db.deleteFrom("spend_budgets").execute();
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();
    budgetStore.invalidate();
  });

  const globalInput = { scope: "global", period: "daily", limitUsd: "10.000000", action: "block" };
  const clientInput = { scope: "client", clientId: CLIENT, period: "daily", limitUsd: "5.000000", action: "warn" };

  // ---- POST ------------------------------------------------------------
  it("POST requires auth", async () => {
    expect((await supertest(app.server).post("/v1/budgets").send(globalInput)).status).toBe(401);
  });

  it("POST creates a global budget", async () => {
    const res = await supertest(app.server).post("/v1/budgets").set(auth()).send(globalInput);
    expect(res.status).toBe(201);
    expect(res.body.budgetId).toMatch(/^budget_/);
    expect(res.body.scope).toBe("global");
    expect(res.body.clientId).toBeNull();
  });

  it("POST creates a client budget", async () => {
    const res = await supertest(app.server).post("/v1/budgets").set(auth()).send(clientInput);
    expect(res.status).toBe(201);
    expect(res.body.scope).toBe("client");
    expect(res.body.clientId).toBe(CLIENT);
  });

  it("POST creates a disabled budget", async () => {
    const res = await supertest(app.server).post("/v1/budgets").set(auth()).send({ ...globalInput, enabled: false });
    expect(res.status).toBe(201);
    expect(res.body.enabled).toBe(false);
  });

  it("POST rejects invalid limit / scope-client / period / action with 400", async () => {
    const bad = [
      { ...globalInput, limitUsd: "0" },
      { ...globalInput, clientId: "x" }, // global + clientId
      { scope: "client", period: "daily", limitUsd: "1", action: "block" }, // client, no clientId
      { ...globalInput, period: "weekly" },
      { ...globalInput, action: "throttle" },
    ];
    for (const body of bad) {
      const res = await supertest(app.server).post("/v1/budgets").set(auth()).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe("invalid_request");
    }
  });

  // ---- GET list / by id ------------------------------------------------
  it("GET list requires auth and returns created budgets deterministically", async () => {
    expect((await supertest(app.server).get("/v1/budgets")).status).toBe(401);
    await budgetStore.create({ scope: "client", clientId: "z", period: "daily", limitUsd: "1", action: "block" });
    await budgetStore.create({ scope: "global", period: "daily", limitUsd: "1", action: "block" });
    const res = await supertest(app.server).get("/v1/budgets").set(auth());
    expect(res.status).toBe(200);
    expect(res.body[0].scope).toBe("global"); // global ordered first
    expect(res.body).toHaveLength(2);
  });

  it("GET :id returns a budget or 404", async () => {
    const b = await budgetStore.create({ scope: "global", period: "daily", limitUsd: "1", action: "block" });
    expect((await supertest(app.server).get(`/v1/budgets/${b.budgetId}`)).status).toBe(401);
    const ok = await supertest(app.server).get(`/v1/budgets/${b.budgetId}`).set(auth());
    expect(ok.status).toBe(200);
    expect(ok.body.budgetId).toBe(b.budgetId);
    const missing = await supertest(app.server).get("/v1/budgets/budget_missing").set(auth());
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("budget_not_found");
  });

  // ---- PATCH -----------------------------------------------------------
  it("PATCH updates mutable fields and revalidates invariants", async () => {
    const b = await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "1", action: "block" });
    expect((await supertest(app.server).patch(`/v1/budgets/${b.budgetId}`).send({ limitUsd: "2" })).status).toBe(401);

    const upd = await supertest(app.server)
      .patch(`/v1/budgets/${b.budgetId}`)
      .set(auth())
      .send({ limitUsd: "9.990000", action: "warn", enabled: false });
    expect(upd.status).toBe(200);
    expect(upd.body.limitUsd).toBe("9.990000");
    expect(upd.body.action).toBe("warn");
    expect(upd.body.enabled).toBe(false);

    // Coherent scope change requires clientId to become null.
    const toGlobal = await supertest(app.server)
      .patch(`/v1/budgets/${b.budgetId}`)
      .set(auth())
      .send({ scope: "global", clientId: null });
    expect(toGlobal.status).toBe(200);
    expect(toGlobal.body.scope).toBe("global");

    // Invalid: scope=global while keeping a clientId, and limit <= 0.
    expect(
      (await supertest(app.server).patch(`/v1/budgets/${b.budgetId}`).set(auth()).send({ scope: "client" })).status,
    ).toBe(400);
    expect(
      (await supertest(app.server).patch(`/v1/budgets/${b.budgetId}`).set(auth()).send({ limitUsd: "0" })).status,
    ).toBe(400);

    expect((await supertest(app.server).patch("/v1/budgets/budget_missing").set(auth()).send({ limitUsd: "1" })).status).toBe(404);
  });

  // ---- DELETE ----------------------------------------------------------
  it("DELETE removes a budget or 404s", async () => {
    const b = await budgetStore.create({ scope: "global", period: "daily", limitUsd: "1", action: "block" });
    expect((await supertest(app.server).delete(`/v1/budgets/${b.budgetId}`)).status).toBe(401);
    expect((await supertest(app.server).delete(`/v1/budgets/${b.budgetId}`).set(auth())).status).toBe(204);
    expect((await supertest(app.server).delete(`/v1/budgets/${b.budgetId}`).set(auth())).status).toBe(404);
  });

  // ---- STATUS ----------------------------------------------------------
  it("status requires auth and returns empty when no budgets apply", async () => {
    expect((await supertest(app.server).get("/v1/budgets/status")).status).toBe(401);
    const res = await supertest(app.server).get("/v1/budgets/status").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.budgets).toEqual([]);
  });

  it("status returns global + this client's budgets, excluding other clients and disabled", async () => {
    await budgetStore.create({ scope: "global", period: "daily", limitUsd: "100", action: "warn" });
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "100", action: "block" });
    await budgetStore.create({ scope: "client", clientId: "other", period: "daily", limitUsd: "100", action: "block" });
    await budgetStore.create({ scope: "global", period: "daily", limitUsd: "100", action: "block", enabled: false });
    const res = await supertest(app.server).get("/v1/budgets/status").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.budgets).toHaveLength(2);
    expect(res.body.budgets.every((b: { clientId: string | null }) => b.clientId === null || b.clientId === CLIENT)).toBe(true);
  });

  it("status computes exact decimal spend/utilization for daily and rolling windows", async () => {
    await db
      .insertInto("telemetry_events")
      .values([spendRow("2.000000", new Date()), spendRow("3.000000", new Date(Date.now() - 10 * 86_400_000))])
      .execute();
    const daily = await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "10.000000", action: "warn" });
    const rolling = await budgetStore.create({ scope: "client", clientId: CLIENT, period: "rolling_30d", limitUsd: "10.000000", action: "warn" });

    const res = await supertest(app.server).get("/v1/budgets/status").set(auth());
    const byId = Object.fromEntries(res.body.budgets.map((b: { budgetId: string }) => [b.budgetId, b]));
    expect(byId[daily.budgetId].currentSpendUsd).toBe("2.000000");
    expect(byId[daily.budgetId].utilization).toBe("0.200000");
    expect(byId[daily.budgetId].status).toBe("below_limit");
    expect(byId[rolling.budgetId].currentSpendUsd).toBe("5.000000");
    expect(byId[rolling.budgetId].utilization).toBe("0.500000");
  });

  it("status reports below/at/over limit and is read-only", async () => {
    await db.insertInto("telemetry_events").values(spendRow("2.000000", new Date())).execute();
    const over = await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "1.000000", action: "warn" });
    const at = await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "2.000000", action: "warn" });

    const res1 = await supertest(app.server).get("/v1/budgets/status").set(auth());
    const m1 = Object.fromEntries(res1.body.budgets.map((b: { budgetId: string }) => [b.budgetId, b]));
    expect(m1[over.budgetId].status).toBe("over_limit");
    expect(m1[over.budgetId].remainingUsd).toBe("-1.000000");
    expect(m1[at.budgetId].status).toBe("at_limit");

    // Read-only: nothing changed between calls.
    const res2 = await supertest(app.server).get("/v1/budgets/status").set(auth());
    expect(res2.body).toEqual(res1.body);
    expect((await db.selectFrom("spend_budgets").selectAll().execute()).length).toBe(2);
  });
});
