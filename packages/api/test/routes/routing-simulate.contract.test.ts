import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

const CLIENT = "simulate-contract";
const MATCH_ALL = { clientIds: null, requiredCapabilities: null, minEstimatedTokens: null, maxEstimatedTokens: null };

gated("contract: POST /v1/routing/simulate", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let secret: string;
  let writer: TelemetryWriter;
  let ruleStore: OperatorRuleStore;
  let budgetStore: BudgetStore;
  let cheap: ReturnType<typeof createMockAdapter>;
  let fast: ReturnType<typeof createMockAdapter>;

  const MSG = { messages: [{ role: "user", content: "hi" }] };

  function simulate(request: unknown, proposedRule: unknown) {
    return supertest(app.server)
      .post("/v1/routing/simulate")
      .set("authorization", `Bearer ${secret}`)
      .send({ request, proposedRule });
  }
  function preview(request: unknown) {
    return supertest(app.server)
      .post("/v1/routing/preview")
      .set("authorization", `Bearer ${secret}`)
      .send(request);
  }

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
    await db.deleteFrom("operator_rules").execute();
    await db.deleteFrom("spend_budgets").execute();
    await db.deleteFrom("budget_decisions").where("client_id", "=", CLIENT).execute();
    await db.deleteFrom("api_keys").where("label", "=", CLIENT).execute();
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();
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
    await db.deleteFrom("operator_rules").execute();
    await db.deleteFrom("spend_budgets").execute();
    await db.deleteFrom("budget_decisions").where("client_id", "=", CLIENT).execute();
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();
    await db.deleteFrom("api_keys").where("label", "=", CLIENT).execute();
    await db.destroy();
    await setProviderHealth(db, "mock-cheap", true, 0).catch(() => undefined);
    await setProviderHealth(db, "mock-fast", true, 0).catch(() => undefined);
  });

  beforeEach(async () => {
    await db.deleteFrom("operator_rules").execute();
    ruleStore.invalidate();
    await db.deleteFrom("spend_budgets").execute();
    budgetStore.invalidate();
    await db.deleteFrom("budget_decisions").where("client_id", "=", CLIENT).execute();
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();
    vi.restoreAllMocks();
  });

  // ---- Governance ----

  it("a matching proposed rule changes the autopilot decision with an exact cost delta", async () => {
    const res = await simulate(MSG, { priority: 10, enabled: true, match: MATCH_ALL, pin: { providerId: "mock-fast", modelId: null } });
    expect(res.status).toBe(200);
    expect(res.body.current.decision.decisionSource).toBe("autopilot");
    expect(res.body.current.decision.chosenProviderId).toBe("mock-cheap");
    expect(res.body.proposed.decision.decisionSource).toBe("operator_rule");
    expect(res.body.proposed.decision.chosenProviderId).toBe("mock-fast");
    expect(res.body.comparison.decisionChanged).toBe(true);
    expect(res.body.comparison.providerChanged).toBe(true);
    expect(res.body.proposal).toMatchObject({ matchesRequest: true, effective: true, shadowedByRuleId: null });

    // Delta is exactly proposed − current (exact decimal).
    const cur = Number(res.body.current.decision.estimatedCostUsd);
    const prop = Number(res.body.proposed.decision.estimatedCostUsd);
    const delta = Number(res.body.comparison.estimatedCostDeltaUsd);
    expect(prop).toBeGreaterThan(cur);
    expect(Math.abs(delta - (prop - cur))).toBeLessThan(1e-9);
  });

  it("a non-matching proposed rule leaves the decision unchanged", async () => {
    const res = await simulate(MSG, {
      priority: 10, enabled: true,
      match: { ...MATCH_ALL, clientIds: ["someone-else"] },
      pin: { providerId: "mock-fast", modelId: null },
    });
    expect(res.body.current.decision.chosenProviderId).toBe("mock-cheap");
    expect(res.body.proposed.decision.chosenProviderId).toBe("mock-cheap");
    expect(res.body.comparison.decisionChanged).toBe(false);
    expect(res.body.proposal).toMatchObject({ matchesRequest: false, effective: false, shadowedByRuleId: null });
  });

  it("a disabled proposed rule does not participate", async () => {
    const res = await simulate(MSG, { priority: 1, enabled: false, match: MATCH_ALL, pin: { providerId: "mock-fast", modelId: null } });
    expect(res.body.proposal).toMatchObject({ matchesRequest: false, effective: false });
    expect(res.body.comparison.decisionChanged).toBe(false);
  });

  it("the proposed rule is shadowed by an existing higher-precedence rule", async () => {
    const live = await ruleStore.create({ priority: 10, enabled: true, match: MATCH_ALL, pin: { providerId: "mock-fast", modelId: null } });
    // Proposed has a larger priority number → lower precedence → shadowed.
    const res = await simulate(MSG, { priority: 20, enabled: true, match: MATCH_ALL, pin: { providerId: "mock-cheap", modelId: "mock-cheap:large" } });
    expect(res.body.current.decision.chosenProviderId).toBe("mock-fast");
    expect(res.body.proposed.decision.chosenProviderId).toBe("mock-fast"); // live rule still governs
    expect(res.body.comparison.decisionChanged).toBe(false);
    expect(res.body.proposal).toMatchObject({ matchesRequest: true, effective: false, shadowedByRuleId: live.ruleId });
  });

  it("the proposed rule shadows an existing lower-precedence rule (production precedence)", async () => {
    await ruleStore.create({ priority: 20, enabled: true, match: MATCH_ALL, pin: { providerId: "mock-fast", modelId: null } });
    const res = await simulate(MSG, { priority: 10, enabled: true, match: MATCH_ALL, pin: { providerId: "mock-cheap", modelId: "mock-cheap:large" } });
    expect(res.body.current.decision.chosenProviderId).toBe("mock-fast");
    expect(res.body.proposed.decision.chosenModelId).toBe("mock-cheap:large");
    expect(res.body.comparison.decisionChanged).toBe(true);
    expect(res.body.proposal).toMatchObject({ matchesRequest: true, effective: true });
  });

  it("honors token-range matching conditions", async () => {
    const res = await simulate(MSG, {
      priority: 10, enabled: true,
      match: { ...MATCH_ALL, minEstimatedTokens: 1_000_000 }, // request is tiny → no match
      pin: { providerId: "mock-fast", modelId: null },
    });
    expect(res.body.proposal.matchesRequest).toBe(false);
    expect(res.body.comparison.decisionChanged).toBe(false);
  });

  // ---- Validation ----

  it("rejects a malformed request", async () => {
    const res = await simulate({ messages: [] }, { priority: 1, enabled: true, match: MATCH_ALL, pin: { providerId: "mock-fast", modelId: null } });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed proposed rule", async () => {
    const res = await simulate(MSG, { priority: 1, enabled: true, match: MATCH_ALL, pin: { providerId: null, modelId: null } });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid proposed target with override_target_missing and no provider call", async () => {
    const cheapSpy = vi.spyOn(cheap, "execute");
    const fastSpy = vi.spyOn(fast, "execute");
    const res = await simulate(MSG, { priority: 1, enabled: true, match: MATCH_ALL, pin: { providerId: "ghost-provider", modelId: null } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("override_target_missing");
    expect(cheapSpy).not.toHaveBeenCalled();
    expect(fastSpy).not.toHaveBeenCalled();
  });

  // ---- Budget ----

  it("reports no_budget when no budgets apply", async () => {
    const res = await simulate(MSG, { priority: 10, enabled: true, match: MATCH_ALL, pin: { providerId: "mock-fast", modelId: null } });
    expect(res.body.current.budget.decision).toBe("no_budget");
    expect(res.body.proposed.budget.decision).toBe("no_budget");
    expect(res.body.comparison.budgetOutcomeChanged).toBe(false);
  });

  it("current allowed / proposed blocked when the proposed decision costs more", async () => {
    const probe = await simulate(MSG, { priority: 10, enabled: true, match: MATCH_ALL, pin: { providerId: "mock-fast", modelId: null } });
    const proposedEst = probe.body.proposed.decision.estimatedCostUsd;
    // Limit = proposed estimate: current (cheaper) stays under; proposed reaches the limit → blocked.
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: proposedEst, action: "block" });

    const res = await simulate(MSG, { priority: 10, enabled: true, match: MATCH_ALL, pin: { providerId: "mock-fast", modelId: null } });
    expect(res.body.current.budget.decision).toBe("allowed");
    expect(res.body.proposed.budget.decision).toBe("blocked");
    expect(res.body.comparison.budgetOutcomeChanged).toBe(true);
  });

  it("current blocked / proposed allowed when the proposed decision costs less", async () => {
    await ruleStore.create({ priority: 20, enabled: true, match: MATCH_ALL, pin: { providerId: "mock-fast", modelId: null } });
    const probe = await simulate(MSG, { priority: 10, enabled: true, match: MATCH_ALL, pin: { providerId: "mock-cheap", modelId: "mock-cheap:small" } });
    const currentEst = probe.body.current.decision.estimatedCostUsd; // mock-fast (expensive)
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: currentEst, action: "block" });

    const res = await simulate(MSG, { priority: 10, enabled: true, match: MATCH_ALL, pin: { providerId: "mock-cheap", modelId: "mock-cheap:small" } });
    expect(res.body.current.budget.decision).toBe("blocked");
    expect(res.body.proposed.budget.decision).toBe("allowed");
    expect(res.body.comparison.budgetOutcomeChanged).toBe(true);
  });

  it("reports a warn budget as warned (not blocked)", async () => {
    const probe = await simulate(MSG, { priority: 10, enabled: true, match: MATCH_ALL, pin: { providerId: "mock-fast", modelId: null } });
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: probe.body.proposed.decision.estimatedCostUsd, action: "warn" });
    const res = await simulate(MSG, { priority: 10, enabled: true, match: MATCH_ALL, pin: { providerId: "mock-fast", modelId: null } });
    expect(res.body.proposed.budget.decision).toBe("warned");
  });

  // ---- Parity ----

  it("current decision matches /v1/routing/preview for identical live state", async () => {
    await ruleStore.create({ priority: 10, enabled: true, match: MATCH_ALL, pin: { providerId: "mock-fast", modelId: null } });
    const prev = await preview(MSG);
    // A non-matching proposed rule does not change the current (live) decision.
    const sim = await simulate(MSG, { priority: 99, enabled: true, match: { ...MATCH_ALL, clientIds: ["nobody"] }, pin: { providerId: "mock-cheap", modelId: null } });
    expect(sim.body.current.decision.decisionSource).toBe(prev.body.decisionSource);
    expect(sim.body.current.decision.chosenProviderId).toBe(prev.body.chosenProviderId);
    expect(sim.body.current.decision.chosenModelId).toBe(prev.body.chosenModelId);
    expect(sim.body.current.decision.estimatedCostUsd).toBe(prev.body.estimatedCostUsd);
  });

  // ---- Side effects ----

  it("has zero side effects: no rule persistence, no telemetry, no budget audit, no provider call", async () => {
    const cheapSpy = vi.spyOn(cheap, "execute");
    const fastSpy = vi.spyOn(fast, "execute");
    await db.insertInto("telemetry_events").values({
      event_id: randomUUID(), received_at: new Date().toISOString(), client_id: CLIENT,
      decision_source: "autopilot", shadowed_source: null, effective_provider_id: "mock-cheap",
      effective_model_id: "mock-cheap:small", attempts: JSON.stringify([]), aggregated_input_tokens: 1,
      aggregated_output_tokens: 1, total_latency_ms: 1, terminal_error_class: "none",
      estimated_cost_usd: "0.000001", actual_cost_usd: null, pricing_table_version_id: "seed-2026-09-08",
      reconciled: null, routing_rationale: JSON.stringify({}),
    }).execute();
    await budgetStore.create({ scope: "client", clientId: CLIENT, period: "daily", limitUsd: "0.000001", action: "block" });

    const rulesBefore = await db.selectFrom("operator_rules").select((eb) => eb.fn.countAll<string>().as("c")).executeTakeFirstOrThrow();
    const teleBefore = await db.selectFrom("telemetry_events").where("client_id", "=", CLIENT).select((eb) => eb.fn.countAll<string>().as("c")).executeTakeFirstOrThrow();
    const auditBefore = await db.selectFrom("budget_decisions").where("client_id", "=", CLIENT).select((eb) => eb.fn.countAll<string>().as("c")).executeTakeFirstOrThrow();

    const res = await simulate(MSG, { priority: 10, enabled: true, match: MATCH_ALL, pin: { providerId: "mock-fast", modelId: null } });
    expect(res.status).toBe(200);
    expect(res.body.proposed.budget.decision).toBe("blocked"); // evaluated, but not enforced/persisted

    const rulesAfter = await db.selectFrom("operator_rules").select((eb) => eb.fn.countAll<string>().as("c")).executeTakeFirstOrThrow();
    const teleAfter = await db.selectFrom("telemetry_events").where("client_id", "=", CLIENT).select((eb) => eb.fn.countAll<string>().as("c")).executeTakeFirstOrThrow();
    const auditAfter = await db.selectFrom("budget_decisions").where("client_id", "=", CLIENT).select((eb) => eb.fn.countAll<string>().as("c")).executeTakeFirstOrThrow();

    expect(rulesAfter.c).toBe(rulesBefore.c);
    expect(teleAfter.c).toBe(teleBefore.c);
    expect(auditAfter.c).toBe(auditBefore.c);
    expect(cheapSpy).not.toHaveBeenCalled();
    expect(fastSpy).not.toHaveBeenCalled();
    // The live rule snapshot never gains the synthetic simulation rule.
    const snap = await ruleStore.snapshot();
    expect(snap.some((r) => r.ruleId === "__simulation__")).toBe(false);
  });

  it("requires Bearer auth", async () => {
    const res = await supertest(app.server).post("/v1/routing/simulate").send({ request: MSG, proposedRule: { priority: 1, enabled: true, match: MATCH_ALL, pin: { providerId: "mock-fast", modelId: null } } });
    expect(res.status).toBe(401);
  });
});
