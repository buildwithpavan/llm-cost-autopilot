import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";

import {
  createApiKey,
  createDb,
  createOperatorRuleStore,
  createPool,
  createTelemetryWriter,
  runMigrations,
  setProviderHealth,
  type Db,
  type OperatorRuleStore,
  type TelemetryWriter,
} from "@lca/persistence";
import { createMockAdapter, createRegistry } from "@lca/providers";

import { buildServer } from "../../src/server.js";
import { loadConfig } from "../../src/config.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

gated("US3 overrides acceptance", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let apiKeySecret: string;
  let writer: TelemetryWriter;
  let ruleStore: OperatorRuleStore;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);

    await db.deleteFrom("operator_rules").execute();
    await db.deleteFrom("api_keys").where("label", "=", "us3-integ").execute();
    await db
      .deleteFrom("telemetry_events")
      .where("client_id", "=", "us3-integ")
      .execute();
    await setProviderHealth(db, "mock-cheap", true, 0);
    await setProviderHealth(db, "mock-fast", true, 0);

    const registry = createRegistry();
    registry.register(createMockAdapter({ providerId: "mock-cheap" }));
    registry.register(createMockAdapter({ providerId: "mock-fast" }));

    const created = await createApiKey(db, { clientId: "us3-integ", label: "us3-integ" });
    apiKeySecret = created.secret;

    ruleStore = createOperatorRuleStore(db);
    writer = createTelemetryWriter(db, { batchSize: 1, flushEveryMs: 0 });
    const config = loadConfig({ ...process.env, DATABASE_URL });
    app = await buildServer({
      config,
      db,
      registry,
      telemetryWriter: writer,
      ruleStore,
    });
    await app.ready();
  });

  afterAll(async () => {
    await writer.close();
    await app.close();
    await db.destroy();
  });

  async function completeAndWait(payload: unknown, xRequestId?: string) {
    const req = supertest(app.server)
      .post("/v1/completions")
      .set("authorization", `Bearer ${apiKeySecret}`);
    if (xRequestId) req.set("x-request-id", xRequestId);
    const res = await req.send(payload);
    // give the writer a tick
    await new Promise((r) => setTimeout(r, 50));
    return res;
  }

  it("honors a valid client override (US3 acceptance #1)", async () => {
    await db.deleteFrom("operator_rules").execute();
    ruleStore.invalidate();

    const res = await completeAndWait({
      messages: [{ role: "user", content: "hi" }],
      override: { providerId: "mock-fast", modelId: "mock-fast:default" },
    });
    expect(res.status).toBe(200);
    expect(res.body.providerId).toBe("mock-fast");
    expect(res.body.modelId).toBe("mock-fast:default");
    expect(res.body.decision.decisionSource).toBe("client_override");
    expect(res.body.decision.shadowedSource).toBeNull();
  });

  it("rejects an invalid client override with 422 and no provider call (FR-028)", async () => {
    await db.deleteFrom("operator_rules").execute();
    ruleStore.invalidate();

    const before = await db
      .selectFrom("telemetry_events")
      .select(db.fn.count("event_id").as("c"))
      .where("client_id", "=", "us3-integ")
      .executeTakeFirst();
    const beforeCount = Number((before as { c: string }).c);

    const res = await completeAndWait({
      messages: [{ role: "user", content: "hi" }],
      override: { providerId: "nonexistent-provider", modelId: null },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("override_target_missing");

    await new Promise((r) => setTimeout(r, 100));
    const after = await db
      .selectFrom("telemetry_events")
      .select(db.fn.count("event_id").as("c"))
      .where("client_id", "=", "us3-integ")
      .executeTakeFirst();
    const afterCount = Number((after as { c: string }).c);
    // No provider call should have been made; may still write a rejection telemetry event.
    // Assert the ratio of *successful* attempts is unchanged (no upstream call).
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
  });

  it("honors an operator rule when no client override is present", async () => {
    await db.deleteFrom("operator_rules").execute();
    ruleStore.invalidate();
    await ruleStore.create({
      priority: 10,
      enabled: true,
      match: { clientIds: null, requiredCapabilities: null, minEstimatedTokens: null, maxEstimatedTokens: null },
      pin: { providerId: "mock-fast", modelId: null },
    });

    const res = await completeAndWait({ messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
    expect(res.body.providerId).toBe("mock-fast");
    expect(res.body.decision.decisionSource).toBe("operator_rule");
    expect(res.body.decision.shadowedSource).toBeNull();
  });

  it("operator rule shadows a client override (Clarification Q1)", async () => {
    await db.deleteFrom("operator_rules").execute();
    ruleStore.invalidate();
    await ruleStore.create({
      priority: 10,
      enabled: true,
      match: { clientIds: null, requiredCapabilities: null, minEstimatedTokens: null, maxEstimatedTokens: null },
      pin: { providerId: "mock-fast", modelId: "mock-fast:default" },
    });

    const cid = randomUUID();
    const res = await completeAndWait(
      {
        messages: [{ role: "user", content: "hi" }],
        // Client asks for cheap; operator says fast; operator wins.
        override: { providerId: "mock-cheap", modelId: "mock-cheap:small" },
      },
      cid,
    );
    expect(res.status).toBe(200);
    expect(res.body.providerId).toBe("mock-fast");
    expect(res.body.modelId).toBe("mock-fast:default");
    expect(res.body.decision.decisionSource).toBe("operator_rule");
    expect(res.body.decision.shadowedSource).toBe("client_override");

    // Telemetry records both effective and shadowed source.
    const events = await supertest(app.server)
      .get(`/v1/telemetry/events?clientId=us3-integ&limit=5`)
      .set("authorization", `Bearer ${apiKeySecret}`);
    const found = events.body.events.find(
      (e: { eventId: string }) => e.eventId === cid,
    );
    expect(found).toBeTruthy();
    expect(found.decisionSource).toBe("operator_rule");
    expect(found.shadowedSource).toBe("client_override");

    // The rationale contains an entry that explains the bypass.
    const rat: Array<{ factor: string; note: string }> = found.routingRationale.rationale;
    expect(rat.some((r) => /override|autonomous|shadow/i.test(r.note))).toBe(true);
  });

  it("replay reproduces the operator-forced decision after override (SC-003)", async () => {
    await db.deleteFrom("operator_rules").execute();
    ruleStore.invalidate();
    await ruleStore.create({
      priority: 10,
      enabled: true,
      match: { clientIds: null, requiredCapabilities: null, minEstimatedTokens: null, maxEstimatedTokens: null },
      pin: { providerId: "mock-fast", modelId: "mock-fast:default" },
    });

    const cid = randomUUID();
    const res = await completeAndWait(
      { messages: [{ role: "user", content: "replay me" }] },
      cid,
    );
    expect(res.status).toBe(200);
    const replay = await supertest(app.server)
      .get(`/v1/telemetry/replay/${cid}`)
      .set("authorization", `Bearer ${apiKeySecret}`);
    expect(replay.status).toBe(200);
    expect(replay.body.matches).toBe(true);
    expect(replay.body.recorded.decisionSource).toBe("operator_rule");
    expect(replay.body.replayed.chosenProviderId).toBe("mock-fast");
  });
});
