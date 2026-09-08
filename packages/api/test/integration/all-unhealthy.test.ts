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

gated("all providers unhealthy (T111, spec Edge Cases)", () => {
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
    await db.deleteFrom("api_keys").where("label", "=", "all-unhealthy").execute();

    const registry = createRegistry();
    registry.register(createMockAdapter({ providerId: "mock-cheap" }));
    registry.register(createMockAdapter({ providerId: "mock-fast" }));

    // Mark every configured provider unhealthy.
    await setProviderHealth(db, "mock-cheap", false, 3);
    await setProviderHealth(db, "mock-fast", false, 3);

    const created = await createApiKey(db, {
      clientId: "all-unhealthy",
      label: "all-unhealthy",
    });
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
    await setProviderHealth(db, "mock-cheap", true, 0);
    await setProviderHealth(db, "mock-fast", true, 0);
    await writer.close();
    await app.close();
    await db.destroy();
  });

  it("returns provider_unavailable structured error, no provider call attempted", async () => {
    const res = await supertest(app.server)
      .post("/v1/completions")
      .set("authorization", `Bearer ${apiKeySecret}`)
      .send({ messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("provider_unavailable");
  });
});
