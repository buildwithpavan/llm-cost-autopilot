import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";

import {
  createApiKey,
  createDb,
  createOperatorRuleStore,
  createPool,
  createTelemetryWriter,
  runMigrations,
  type Db,
  type OperatorRuleStore,
  type TelemetryWriter,
} from "@lca/persistence";
import { createMockAdapter, createRegistry } from "@lca/providers";

import { buildServer } from "../../src/server.js";
import { loadConfig } from "../../src/config.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

gated("contract: /v1/operator/rules", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let secret: string;
  let writer: TelemetryWriter;
  let ruleStore: OperatorRuleStore;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
    await db.deleteFrom("api_keys").where("label", "=", "rules-contract").execute();

    const registry = createRegistry();
    registry.register(createMockAdapter({ providerId: "mock-cheap" }));

    const created = await createApiKey(db, {
      clientId: "rules-contract",
      label: "rules-contract",
    });
    secret = created.secret;

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
  });

  beforeEach(async () => {
    await db.deleteFrom("operator_rules").execute();
    ruleStore.invalidate();
  });

  it("GET /v1/operator/rules returns 401 without auth", async () => {
    const res = await supertest(app.server).get("/v1/operator/rules");
    expect(res.status).toBe(401);
  });

  it("GET /v1/operator/rules returns an array on 200", async () => {
    const res = await supertest(app.server)
      .get("/v1/operator/rules")
      .set("authorization", `Bearer ${secret}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /v1/operator/rules creates a rule and returns 201 with the persisted shape", async () => {
    const res = await supertest(app.server)
      .post("/v1/operator/rules")
      .set("authorization", `Bearer ${secret}`)
      .send({
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
    expect(res.status).toBe(201);
    expect(res.body.ruleId).toBeTruthy();
    expect(res.body.priority).toBe(5);
    expect(res.body.pin.providerId).toBe("mock-cheap");
  });

  it("POST /v1/operator/rules returns 400 on malformed body", async () => {
    const res = await supertest(app.server)
      .post("/v1/operator/rules")
      .set("authorization", `Bearer ${secret}`)
      .send({ priority: "not-a-number" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_request");
  });

  it("PATCH /v1/operator/rules/{id} updates fields and returns 200", async () => {
    const created = await ruleStore.create({
      priority: 10,
      enabled: true,
      match: { clientIds: null, requiredCapabilities: null, minEstimatedTokens: null, maxEstimatedTokens: null },
      pin: { providerId: "mock-cheap", modelId: null },
    });
    const res = await supertest(app.server)
      .patch(`/v1/operator/rules/${created.ruleId}`)
      .set("authorization", `Bearer ${secret}`)
      .send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  it("PATCH /v1/operator/rules/{missing} returns 404", async () => {
    const res = await supertest(app.server)
      .patch("/v1/operator/rules/does-not-exist")
      .set("authorization", `Bearer ${secret}`)
      .send({ enabled: false });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("rule_not_found");
  });

  it("DELETE /v1/operator/rules/{id} returns 204", async () => {
    const created = await ruleStore.create({
      priority: 10,
      enabled: true,
      match: { clientIds: null, requiredCapabilities: null, minEstimatedTokens: null, maxEstimatedTokens: null },
      pin: { providerId: "mock-cheap", modelId: null },
    });
    const res = await supertest(app.server)
      .delete(`/v1/operator/rules/${created.ruleId}`)
      .set("authorization", `Bearer ${secret}`);
    expect(res.status).toBe(204);
  });

  it("DELETE /v1/operator/rules/{missing} returns 404", async () => {
    const res = await supertest(app.server)
      .delete("/v1/operator/rules/does-not-exist")
      .set("authorization", `Bearer ${secret}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("rule_not_found");
  });
});
