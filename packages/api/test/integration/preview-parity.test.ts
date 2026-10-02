import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const CLIENT_ID = "preview-parity";

gated("Routing preview parity with completions", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let apiKeySecret: string;
  let writer: TelemetryWriter;
  let ruleStore: OperatorRuleStore;
  let cheap: ReturnType<typeof createMockAdapter>;
  let fast: ReturnType<typeof createMockAdapter>;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);

    await db.deleteFrom("operator_rules").execute();
    await db.deleteFrom("api_keys").where("label", "=", CLIENT_ID).execute();
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT_ID).execute();
    await setProviderHealth(db, "mock-cheap", true, 0);
    await setProviderHealth(db, "mock-fast", true, 0);

    const registry = createRegistry();
    cheap = createMockAdapter({ providerId: "mock-cheap" });
    fast = createMockAdapter({ providerId: "mock-fast" });
    registry.register(cheap);
    registry.register(fast);

    const created = await createApiKey(db, { clientId: CLIENT_ID, label: CLIENT_ID });
    apiKeySecret = created.secret;

    ruleStore = createOperatorRuleStore(db);
    writer = createTelemetryWriter(db, { batchSize: 1, flushEveryMs: 0 });
    const config = loadConfig({ ...process.env, DATABASE_URL });
    app = await buildServer({ config, db, registry, telemetryWriter: writer, ruleStore });
    await app.ready();
  });

  afterAll(async () => {
    await writer.close();
    await app.close();
    await db.destroy();
    // Restore shared provider health for other DB-backed suites.
    await setProviderHealth(db, "mock-cheap", true, 0).catch(() => undefined);
    await setProviderHealth(db, "mock-fast", true, 0).catch(() => undefined);
  });

  beforeEach(async () => {
    await db.deleteFrom("operator_rules").execute();
    ruleStore.invalidate();
    vi.restoreAllMocks();
  });

  function preview(payload: unknown) {
    return supertest(app.server)
      .post("/v1/routing/preview")
      .set("authorization", `Bearer ${apiKeySecret}`)
      .send(payload);
  }

  it("returns operator_rule when a rule matches", async () => {
    await ruleStore.create({
      priority: 10,
      enabled: true,
      match: { clientIds: null, requiredCapabilities: null, minEstimatedTokens: null, maxEstimatedTokens: null },
      pin: { providerId: "mock-fast", modelId: null },
    });

    const res = await preview({ messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
    expect(res.body.decisionSource).toBe("operator_rule");
    expect(res.body.chosenProviderId).toBe("mock-fast");
    expect(res.body.shadowedSource).toBeNull();
    // Pinned decisions are now priced with the same estimator as autopilot.
    expect(res.body.estimatedCostUsd).toMatch(/^\d+(\.\d+)?$/);
    expect(Number(res.body.estimatedCostUsd)).toBeGreaterThan(0);
  });

  it("returns client_override when only a client override is present", async () => {
    const res = await preview({
      messages: [{ role: "user", content: "hi" }],
      override: { providerId: "mock-fast", modelId: null },
    });
    expect(res.status).toBe(200);
    expect(res.body.decisionSource).toBe("client_override");
    expect(res.body.chosenProviderId).toBe("mock-fast");
    expect(res.body.shadowedSource).toBeNull();
    expect(res.body.estimatedCostUsd).toMatch(/^\d+(\.\d+)?$/);
    expect(Number(res.body.estimatedCostUsd)).toBeGreaterThan(0);
  });

  it("resolves an explicit provider/model pin to that exact target", async () => {
    const res = await preview({
      messages: [{ role: "user", content: "hi" }],
      override: { providerId: "mock-fast", modelId: "mock-fast:default" },
    });
    expect(res.status).toBe(200);
    expect(res.body.decisionSource).toBe("client_override");
    expect(res.body.chosenProviderId).toBe("mock-fast");
    expect(res.body.chosenModelId).toBe("mock-fast:default");
  });

  it("rejects an invalid override target with 422 override_target_missing", async () => {
    const res = await preview({
      messages: [{ role: "user", content: "hi" }],
      override: { providerId: "nonexistent-provider", modelId: null },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("override_target_missing");
  });

  it("falls back to autopilot when no override or rule applies", async () => {
    const res = await preview({ messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
    expect(res.body.decisionSource).toBe("autopilot");
    expect(res.body.shadowedSource).toBeNull();
  });

  it("records shadowedSource when an operator rule shadows a client override", async () => {
    await ruleStore.create({
      priority: 10,
      enabled: true,
      match: { clientIds: null, requiredCapabilities: null, minEstimatedTokens: null, maxEstimatedTokens: null },
      pin: { providerId: "mock-fast", modelId: "mock-fast:default" },
    });

    const res = await preview({
      messages: [{ role: "user", content: "hi" }],
      override: { providerId: "mock-cheap", modelId: "mock-cheap:small" },
    });
    expect(res.status).toBe(200);
    expect(res.body.decisionSource).toBe("operator_rule");
    expect(res.body.chosenProviderId).toBe("mock-fast");
    expect(res.body.chosenModelId).toBe("mock-fast:default");
    expect(res.body.shadowedSource).toBe("client_override");
  });

  it("performs zero provider calls", async () => {
    const cheapExec = vi.spyOn(cheap, "execute");
    const fastExec = vi.spyOn(fast, "execute");

    await ruleStore.create({
      priority: 10,
      enabled: true,
      match: { clientIds: null, requiredCapabilities: null, minEstimatedTokens: null, maxEstimatedTokens: null },
      pin: { providerId: "mock-fast", modelId: null },
    });

    // Cover an override, an operator pin, and autopilot in one pass.
    await preview({ messages: [{ role: "user", content: "hi" }] });
    await preview({
      messages: [{ role: "user", content: "hi" }],
      override: { providerId: "mock-cheap", modelId: null },
    });

    expect(cheapExec).not.toHaveBeenCalled();
    expect(fastExec).not.toHaveBeenCalled();
  });

  it("writes no telemetry events", async () => {
    const before = await db
      .selectFrom("telemetry_events")
      .select(db.fn.count("event_id").as("c"))
      .where("client_id", "=", CLIENT_ID)
      .executeTakeFirst();
    const beforeCount = Number((before as { c: string }).c);

    await preview({
      messages: [{ role: "user", content: `preview ${randomUUID()}` }],
      override: { providerId: "mock-fast", modelId: null },
    });
    await preview({ messages: [{ role: "user", content: "autopilot preview" }] });

    await new Promise((r) => setTimeout(r, 100));
    const after = await db
      .selectFrom("telemetry_events")
      .select(db.fn.count("event_id").as("c"))
      .where("client_id", "=", CLIENT_ID)
      .executeTakeFirst();
    const afterCount = Number((after as { c: string }).c);
    expect(afterCount).toBe(beforeCount);
  });
});
