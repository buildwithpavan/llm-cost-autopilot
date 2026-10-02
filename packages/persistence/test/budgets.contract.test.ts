import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createBudgetStore } from "../src/budgets/store.js";
import { sumEstimatedSpend } from "../src/budgets/spend.js";
import { createDb, createPool, type Db } from "../src/db/schema.js";
import { runMigrations } from "../src/db/migrate.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

const PRICING = "budget-test-pricing";
const CLIENTS = ["bud-a", "bud-b", "bud-bulk", "bud-none"];

function evRow(o: { clientId: string; estimated: string; receivedAt: Date }) {
  return {
    event_id: randomUUID(),
    received_at: o.receivedAt.toISOString(),
    client_id: o.clientId,
    decision_source: "autopilot" as const,
    shadowed_source: null,
    effective_provider_id: "bud-prov",
    effective_model_id: "bud:model",
    attempts: JSON.stringify([]),
    aggregated_input_tokens: 1,
    aggregated_output_tokens: 1,
    total_latency_ms: 1,
    terminal_error_class: "none",
    estimated_cost_usd: o.estimated,
    actual_cost_usd: null,
    pricing_table_version_id: PRICING,
    reconciled: null,
    routing_rationale: JSON.stringify({}),
  };
}

gated("budget store + spend lookup", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let store: ReturnType<typeof createBudgetStore>;

  const now = new Date();
  const tenDaysAgo = new Date(now.getTime() - 10 * 86_400_000);
  // Fixed historical instant used for isolated global-aggregation assertions.
  const G = new Date("2026-09-15T12:00:00.000Z");

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
    store = createBudgetStore(db);

    for (const c of CLIENTS) {
      await db.deleteFrom("telemetry_events").where("client_id", "=", c).execute();
    }
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db
      .insertInto("pricing_tables")
      .values({ version_id: PRICING, effective_from: new Date(), is_active: false })
      .execute();

    await db
      .insertInto("telemetry_events")
      .values([
        evRow({ clientId: "bud-a", estimated: "0.100000", receivedAt: now }),
        evRow({ clientId: "bud-a", estimated: "0.200000", receivedAt: tenDaysAgo }),
        evRow({ clientId: "bud-b", estimated: "1.000000", receivedAt: now }),
        // Isolated instant for exact global aggregation.
        evRow({ clientId: "bud-a", estimated: "0.050000", receivedAt: G }),
        evRow({ clientId: "bud-b", estimated: "0.070000", receivedAt: G }),
      ])
      .execute();

    const bulk = [];
    for (let i = 0; i < 5001; i++) {
      bulk.push(evRow({ clientId: "bud-bulk", estimated: "0.000001", receivedAt: now }));
    }
    for (let i = 0; i < bulk.length; i += 1000) {
      await db.insertInto("telemetry_events").values(bulk.slice(i, i + 1000)).execute();
    }
  });

  afterAll(async () => {
    for (const c of CLIENTS) {
      await db.deleteFrom("telemetry_events").where("client_id", "=", c).execute();
    }
    await db.deleteFrom("spend_budgets").execute();
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db.destroy();
  });

  beforeEach(async () => {
    await db.deleteFrom("spend_budgets").execute();
    store.invalidate();
  });

  // ---- CRUD ------------------------------------------------------------

  it("creates a global budget with a null clientId", async () => {
    const b = await store.create({ scope: "global", period: "daily", limitUsd: "10.000000", action: "block" });
    expect(b.budgetId).toMatch(/^budget_/);
    expect(b.scope).toBe("global");
    expect(b.clientId).toBeNull();
    expect(b.limitUsd).toBe("10.000000");
    expect(b.enabled).toBe(true);
  });

  it("creates a client budget", async () => {
    const b = await store.create({ scope: "client", clientId: "acme", period: "rolling_30d", limitUsd: "2.500000", action: "warn" });
    expect(b.scope).toBe("client");
    expect(b.clientId).toBe("acme");
    expect(b.action).toBe("warn");
  });

  it("lists budgets with global ordered before client", async () => {
    await store.create({ scope: "client", clientId: "zeta", period: "daily", limitUsd: "1", action: "block" });
    await store.create({ scope: "global", period: "daily", limitUsd: "1", action: "block" });
    const list = await store.list();
    expect(list.map((b) => b.scope)).toEqual(["global", "client"]);
  });

  it("gets a budget by id and returns null for a missing id", async () => {
    const b = await store.create({ scope: "global", period: "daily", limitUsd: "1", action: "block" });
    expect((await store.get(b.budgetId))?.budgetId).toBe(b.budgetId);
    expect(await store.get("budget_missing")).toBeNull();
  });

  it("updates a budget", async () => {
    const b = await store.create({ scope: "global", period: "daily", limitUsd: "1", action: "block" });
    const u = await store.update(b.budgetId, { limitUsd: "9.990000", action: "warn", enabled: false });
    expect(u?.limitUsd).toBe("9.990000");
    expect(u?.action).toBe("warn");
    expect(u?.enabled).toBe(false);
  });

  it("deletes a budget", async () => {
    const b = await store.create({ scope: "global", period: "daily", limitUsd: "1", action: "block" });
    expect(await store.remove(b.budgetId)).toBe(true);
    expect(await store.get(b.budgetId)).toBeNull();
    expect(await store.remove(b.budgetId)).toBe(false);
  });

  // ---- applicable lookup ----------------------------------------------

  it("applicable() with no clientId returns only enabled global budgets", async () => {
    await store.create({ scope: "global", period: "daily", limitUsd: "1", action: "block" });
    await store.create({ scope: "client", clientId: "acme", period: "daily", limitUsd: "1", action: "block" });
    const app = await store.applicable();
    expect(app).toHaveLength(1);
    expect(app[0]!.scope).toBe("global");
  });

  it("applicable(clientId) returns global + matching client budgets, not other clients'", async () => {
    await store.create({ scope: "global", period: "daily", limitUsd: "1", action: "block" });
    await store.create({ scope: "client", clientId: "acme", period: "daily", limitUsd: "1", action: "block" });
    await store.create({ scope: "client", clientId: "other", period: "daily", limitUsd: "1", action: "block" });
    const app = await store.applicable("acme");
    expect(app.map((b) => `${b.scope}:${b.clientId ?? ""}`)).toEqual(["global:", "client:acme"]);
  });

  it("excludes disabled budgets from applicable()", async () => {
    await store.create({ scope: "global", period: "daily", limitUsd: "1", action: "block", enabled: false });
    await store.create({ scope: "client", clientId: "acme", period: "daily", limitUsd: "1", action: "block", enabled: false });
    expect(await store.applicable("acme")).toHaveLength(0);
  });

  it("produces deterministic ordering across repeated snapshots", async () => {
    await store.create({ scope: "client", clientId: "b", period: "daily", limitUsd: "1", action: "block" });
    await store.create({ scope: "client", clientId: "a", period: "daily", limitUsd: "1", action: "block" });
    await store.create({ scope: "global", period: "daily", limitUsd: "1", action: "block" });
    store.invalidate();
    const first = (await store.snapshot()).map((b) => `${b.scope}:${b.clientId ?? ""}`);
    store.invalidate();
    const second = (await store.snapshot()).map((b) => `${b.scope}:${b.clientId ?? ""}`);
    expect(first).toEqual(second);
    expect(first).toEqual(["global:", "client:a", "client:b"]);
  });

  // ---- DB constraints --------------------------------------------------

  it("rejects invalid scope/period/action/limit and scope/client mismatches at the DB layer", async () => {
    const base = {
      budget_id: "x",
      client_id: null as string | null,
      limit_usd: "1.000000",
      enabled: true,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const insert = (vals: Record<string, unknown>) =>
      db.insertInto("spend_budgets").values(vals as never).execute();

    await expect(insert({ ...base, scope: "bogus", period: "daily", action: "block" })).rejects.toThrow();
    await expect(insert({ ...base, scope: "global", period: "weekly", action: "block" })).rejects.toThrow();
    await expect(insert({ ...base, scope: "global", period: "daily", action: "throttle" })).rejects.toThrow();
    await expect(insert({ ...base, scope: "global", period: "daily", action: "block", limit_usd: "0" })).rejects.toThrow();
    await expect(
      insert({ ...base, scope: "global", period: "daily", action: "block", client_id: "acme" }),
    ).rejects.toThrow();
    await expect(
      insert({ ...base, scope: "client", period: "daily", action: "block", client_id: null }),
    ).rejects.toThrow();
  });

  // ---- spend lookup ----------------------------------------------------

  it("sums daily client spend (today's window only)", async () => {
    const budget = await store.create({ scope: "client", clientId: "bud-a", period: "daily", limitUsd: "100", action: "block" });
    expect(await store.currentSpendUsd(budget, now)).toBe("0.100000");
  });

  it("sums rolling-30d client spend (includes aged event)", async () => {
    const budget = await store.create({ scope: "client", clientId: "bud-a", period: "rolling_30d", limitUsd: "100", action: "block" });
    // today 0.1 + ten-days-ago 0.2 + 2026-09-15 0.05 (all within 30d of now)
    expect(await store.currentSpendUsd(budget, now)).toBe("0.350000");
  });

  it("filters spend by clientId", async () => {
    const a = await store.create({ scope: "client", clientId: "bud-a", period: "daily", limitUsd: "100", action: "block" });
    const b = await store.create({ scope: "client", clientId: "bud-b", period: "daily", limitUsd: "100", action: "block" });
    expect(await store.currentSpendUsd(a, now)).toBe("0.100000");
    expect(await store.currentSpendUsd(b, now)).toBe("1.000000");
  });

  it("aggregates global spend across clients over a window", async () => {
    const since = "2026-09-15T11:59:00.000Z";
    const until = "2026-09-15T12:01:00.000Z";
    expect(await sumEstimatedSpend(db, { since, until })).toBe("0.120000");
    // Same window scoped to one client.
    expect(await sumEstimatedSpend(db, { since, until, clientId: "bud-a" })).toBe("0.050000");
  });

  it("returns exact zero for an empty window", async () => {
    const budget = await store.create({ scope: "client", clientId: "bud-none", period: "daily", limitUsd: "100", action: "block" });
    expect(await store.currentSpendUsd(budget, now)).toBe("0");
  });

  it("aggregates spend over more than 5000 events without a cap", async () => {
    const budget = await store.create({ scope: "client", clientId: "bud-bulk", period: "daily", limitUsd: "100", action: "block" });
    expect(await store.currentSpendUsd(budget, now)).toBe("0.005001");
  });
});
