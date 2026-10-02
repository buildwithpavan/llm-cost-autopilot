import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { budgetDecisionExists, queryBudgetDecisions, writeBudgetDecision, type BudgetDecisionRecord } from "../src/budgets/decisions.js";
import { createDb, createPool, type Db } from "../src/db/schema.js";
import { runMigrations } from "../src/db/migrate.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

const CLIENT = "bd-client";

function rec(over: Partial<BudgetDecisionRecord> = {}): BudgetDecisionRecord {
  return {
    eventId: randomUUID(),
    decidedAt: new Date().toISOString(),
    clientId: CLIENT,
    decision: "blocked",
    requestEstimatedCostUsd: "0.001234",
    applicableBudgetIds: ["budget_a", "budget_b"],
    blockedBudgetIds: ["budget_a"],
    evaluations: [
      {
        budgetId: "budget_a",
        scope: "client",
        clientId: CLIENT,
        period: "daily",
        action: "block",
        decision: "block",
        currentSpendUsd: "1.000000",
        projectedSpendUsd: "1.001234",
        limitUsd: "1.000000",
        remainingUsd: "-0.001234",
        overBudget: true,
      },
    ],
    ...over,
  };
}

gated("budget_decisions persistence", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
  });

  afterAll(async () => {
    await db.deleteFrom("budget_decisions").where("client_id", "in", [CLIENT, "bd-other"]).execute();
    await db.destroy();
  });

  beforeEach(async () => {
    await db.deleteFrom("budget_decisions").where("client_id", "in", [CLIENT, "bd-other"]).execute();
  });

  it("writes and reads back a decision with exact decimal and payload integrity", async () => {
    const r = rec();
    await writeBudgetDecision(db, r);
    const [read] = await queryBudgetDecisions(db, { clientId: CLIENT });
    expect(read!.eventId).toBe(r.eventId);
    expect(read!.decision).toBe("blocked");
    expect(read!.requestEstimatedCostUsd).toBe("0.001234");
    expect(read!.blockedBudgetIds).toEqual(["budget_a"]);
    expect(read!.applicableBudgetIds).toEqual(["budget_a", "budget_b"]);
    expect(read!.evaluations[0]!.limitUsd).toBe("1.000000");
    expect(read!.evaluations[0]!.remainingUsd).toBe("-0.001234");
  });

  it("orders decisions most-recent-first", async () => {
    await writeBudgetDecision(db, rec({ eventId: "e1", decidedAt: "2026-10-01T00:00:00.000Z" }));
    await writeBudgetDecision(db, rec({ eventId: "e2", decidedAt: "2026-10-02T00:00:00.000Z" }));
    const rows = await queryBudgetDecisions(db, { clientId: CLIENT });
    expect(rows.map((r) => r.eventId)).toEqual(["e2", "e1"]);
  });

  it("filters by clientId and time window", async () => {
    await writeBudgetDecision(db, rec({ eventId: "mine" }));
    await writeBudgetDecision(db, rec({ eventId: "theirs", clientId: "bd-other" }));
    expect((await queryBudgetDecisions(db, { clientId: CLIENT })).map((r) => r.eventId)).toEqual(["mine"]);
    const since = new Date(Date.now() - 60_000).toISOString();
    expect((await queryBudgetDecisions(db, { clientId: CLIENT, since })).length).toBe(1);
    const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect((await queryBudgetDecisions(db, { clientId: CLIENT, until: old })).length).toBe(0);
  });

  it("is idempotent per eventId (onConflict do nothing)", async () => {
    const r = rec({ eventId: "dup" });
    await writeBudgetDecision(db, r);
    await writeBudgetDecision(db, { ...r, decision: "warned" }); // ignored
    const rows = await queryBudgetDecisions(db, { clientId: CLIENT });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.decision).toBe("blocked");
  });

  it("budgetDecisionExists reflects presence", async () => {
    expect(await budgetDecisionExists(db, "nope")).toBe(false);
    await writeBudgetDecision(db, rec({ eventId: "present" }));
    expect(await budgetDecisionExists(db, "present")).toBe(true);
  });

  it("returns empty for a client with no decisions", async () => {
    expect(await queryBudgetDecisions(db, { clientId: "bd-other" })).toEqual([]);
  });
});
