import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";

import {
  createApiKey,
  createDb,
  createPool,
  createTelemetryWriter,
  runMigrations,
  setProviderHealth,
  type Db,
  type TelemetryWriter,
} from "@lca/persistence";
import { createMockAdapter, createRegistry } from "@lca/providers";

import { buildServer } from "../../src/server.js";
import { loadConfig } from "../../src/config.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

gated("US1 routing acceptance", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let apiKeySecret: string;
  let writer: TelemetryWriter;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);

    await db.deleteFrom("api_keys").where("label", "=", "us1-integ").execute();
    await setProviderHealth(db, "mock-cheap", true, 0);
    await setProviderHealth(db, "mock-fast", true, 0);

    const registry = createRegistry();
    registry.register(createMockAdapter({ providerId: "mock-cheap" }));
    registry.register(createMockAdapter({ providerId: "mock-fast" }));

    const created = await createApiKey(db, { clientId: "us1-integ", label: "us1-integ" });
    apiKeySecret = created.secret;

    writer = createTelemetryWriter(db, { batchSize: 1, flushEveryMs: 0 });
    const config = loadConfig({ ...process.env, DATABASE_URL });
    app = await buildServer({ config, db, registry, telemetryWriter: writer });
    await app.ready();
  });

  afterAll(async () => {
    await writer.close();
    await app.close();
    await db.destroy();
  });

  it("routes a request to a healthy provider and returns a normalized response (US1 acceptance #1)", async () => {
    const res = await supertest(app.server)
      .post("/v1/completions")
      .set("authorization", `Bearer ${apiKeySecret}`)
      .send({ messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
    expect(res.body.decision.decisionSource).toBe("autopilot");
    expect(res.body.decision.pricingTableVersionId).toMatch(/^seed-/);
    expect(res.body.providerId).toMatch(/^mock-/);
    expect(res.body.modelId).toBeTruthy();
    expect(typeof res.body.content).toBe("string");
  });

  it("is deterministic across identical requests (FR-011)", async () => {
    const body = { messages: [{ role: "user", content: "same input" }] };
    const a = await supertest(app.server)
      .post("/v1/completions")
      .set("authorization", `Bearer ${apiKeySecret}`)
      .send(body);
    const b = await supertest(app.server)
      .post("/v1/completions")
      .set("authorization", `Bearer ${apiKeySecret}`)
      .send(body);
    expect(a.body.decision.chosenModelId).toBe(b.body.decision.chosenModelId);
    expect(a.body.decision.chosenProviderId).toBe(b.body.decision.chosenProviderId);
  });

  it("rejects a request that exceeds every candidate's context window (FR-030)", async () => {
    const huge = "x".repeat(1_000_000); // > any mock's context window
    const res = await supertest(app.server)
      .post("/v1/completions")
      .set("authorization", `Bearer ${apiKeySecret}`)
      .send({ messages: [{ role: "user", content: huge }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("context_exceeded");
  });

  it("returns 401 without an API key (FR-037)", async () => {
    const res = await supertest(app.server)
      .post("/v1/completions")
      .send({ messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("responds to GET /v1/catalog with active pricing version + models", async () => {
    const res = await supertest(app.server)
      .get("/v1/catalog")
      .set("authorization", `Bearer ${apiKeySecret}`);
    expect(res.status).toBe(200);
    expect(res.body.pricingTableVersionId).toBeTruthy();
    expect(Array.isArray(res.body.models)).toBe(true);
    expect(res.body.models.length).toBeGreaterThan(0);
  });

  it("POST /v1/routing/preview returns a decision without contacting any provider", async () => {
    const res = await supertest(app.server)
      .post("/v1/routing/preview")
      .set("authorization", `Bearer ${apiKeySecret}`)
      .send({ messages: [{ role: "user", content: "preview me" }] });
    expect(res.status).toBe(200);
    expect(res.body.decisionSource).toBe("autopilot");
    expect(res.body.chosenModelId).toBeTruthy();
    expect(Array.isArray(res.body.candidateRanking)).toBe(true);
  });

  it("responds ok on /v1/health when active pricing exists", async () => {
    const res = await supertest(app.server).get("/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.checks.pricing_active.ok).toBe(true);
  });
});
