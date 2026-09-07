import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createDb,
  createPool,
  createOperatorRuleStore,
  runMigrations,
  type Db,
} from "../src/index.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

gated("operator-rule store (T088)", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db.deleteFrom("operator_rules").execute();
  });

  it("createRule persists and returns the rule with a generated ID", async () => {
    const store = createOperatorRuleStore(db);
    const rule = await store.create({
      priority: 5,
      enabled: true,
      match: {
        clientIds: ["c1"],
        requiredCapabilities: null,
        minEstimatedTokens: null,
        maxEstimatedTokens: null,
      },
      pin: { providerId: "mock-cheap", modelId: null },
    });
    expect(rule.ruleId).toBeTruthy();
    expect(rule.priority).toBe(5);
    expect(rule.match.clientIds).toEqual(["c1"]);
    expect(rule.pin.providerId).toBe("mock-cheap");
    expect(rule.createdAt).toBeTruthy();
  });

  it("list returns rules ordered by priority ascending", async () => {
    const store = createOperatorRuleStore(db);
    await store.create({
      priority: 20,
      enabled: true,
      match: { clientIds: null, requiredCapabilities: null, minEstimatedTokens: null, maxEstimatedTokens: null },
      pin: { providerId: "p20", modelId: null },
    });
    await store.create({
      priority: 5,
      enabled: true,
      match: { clientIds: null, requiredCapabilities: null, minEstimatedTokens: null, maxEstimatedTokens: null },
      pin: { providerId: "p5", modelId: null },
    });
    const rules = await store.list();
    expect(rules.map((r) => r.priority)).toEqual([5, 20]);
  });

  it("update mutates the rule and refreshes updatedAt", async () => {
    const store = createOperatorRuleStore(db);
    const created = await store.create({
      priority: 5,
      enabled: true,
      match: { clientIds: null, requiredCapabilities: null, minEstimatedTokens: null, maxEstimatedTokens: null },
      pin: { providerId: "before", modelId: null },
    });
    await new Promise((r) => setTimeout(r, 10));
    const updated = await store.update(created.ruleId, {
      pin: { providerId: "after", modelId: null },
    });
    expect(updated?.pin.providerId).toBe("after");
    expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updatedAt).getTime(),
    );
  });

  it("delete removes the rule", async () => {
    const store = createOperatorRuleStore(db);
    const created = await store.create({
      priority: 5,
      enabled: true,
      match: { clientIds: null, requiredCapabilities: null, minEstimatedTokens: null, maxEstimatedTokens: null },
      pin: { providerId: "p", modelId: null },
    });
    const removed = await store.remove(created.ruleId);
    expect(removed).toBe(true);
    const rules = await store.list();
    expect(rules).toHaveLength(0);
  });

  it("snapshot returns a cached view that invalidates on write", async () => {
    const store = createOperatorRuleStore(db);
    // Empty snapshot before any rules.
    expect((await store.snapshot()).length).toBe(0);
    const rule = await store.create({
      priority: 5,
      enabled: true,
      match: { clientIds: null, requiredCapabilities: null, minEstimatedTokens: null, maxEstimatedTokens: null },
      pin: { providerId: "p", modelId: null },
    });
    // After create, snapshot must include the new rule (cache invalidated).
    const snap = await store.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]!.ruleId).toBe(rule.ruleId);

    // Two consecutive snapshot() calls without a write should return the same array reference (cache hit).
    const a = await store.snapshot();
    const b = await store.snapshot();
    expect(a).toBe(b);

    // After update, cache should invalidate.
    await store.update(rule.ruleId, { enabled: false });
    const c = await store.snapshot();
    expect(c).not.toBe(a);
    expect(c[0]!.enabled).toBe(false);
  });
});
