import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";

import {
  createApiKey,
  createDb,
  createPool,
  createTelemetryWriter,
  runMigrations,
  type Db,
  type TelemetryWriter,
} from "@lca/persistence";
import { createMockAdapter, createRegistry } from "@lca/providers";

import { buildServer } from "../../src/server.js";
import { loadConfig } from "../../src/config.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

gated("contract: /v1/keys", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let adminSecret: string;
  let writer: TelemetryWriter;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
    await db.deleteFrom("api_keys").where("label", "in", ["keys-admin", "keys-child"]).execute();

    const registry = createRegistry();
    registry.register(createMockAdapter({ providerId: "mock-cheap" }));

    const created = await createApiKey(db, { clientId: "keys-admin", label: "keys-admin" });
    adminSecret = created.secret;

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

  it("GET /v1/keys returns 401 without auth", async () => {
    const res = await supertest(app.server).get("/v1/keys");
    expect(res.status).toBe(401);
  });

  it("GET /v1/keys returns an array of metadata (no secret field)", async () => {
    const res = await supertest(app.server)
      .get("/v1/keys")
      .set("authorization", `Bearer ${adminSecret}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const row of res.body) {
      expect(row).not.toHaveProperty("secret");
      expect(row).not.toHaveProperty("hashedSecret");
      expect(row).not.toHaveProperty("hashed_secret");
    }
  });

  it("POST /v1/keys returns secret exactly once on create and never again on list", async () => {
    const create = await supertest(app.server)
      .post("/v1/keys")
      .set("authorization", `Bearer ${adminSecret}`)
      .send({ clientId: "keys-child", label: "keys-child" });
    expect(create.status).toBe(201);
    expect(create.body.secret).toMatch(/^lca_/);
    expect(create.body.keyId).toBeTruthy();
    const childKeyId = create.body.keyId as string;
    const childSecret = create.body.secret as string;

    // List again — child metadata must be present, but the secret must not.
    const list = await supertest(app.server)
      .get("/v1/keys")
      .set("authorization", `Bearer ${adminSecret}`);
    const found = list.body.find((r: { keyId: string }) => r.keyId === childKeyId);
    expect(found).toBeTruthy();
    const serializedList = JSON.stringify(list.body);
    expect(serializedList).not.toContain(childSecret);

    // The freshly minted key must actually work.
    const useIt = await supertest(app.server)
      .get("/v1/keys")
      .set("authorization", `Bearer ${childSecret}`);
    expect(useIt.status).toBe(200);
  });

  it("POST /v1/keys returns 400 on malformed body", async () => {
    const res = await supertest(app.server)
      .post("/v1/keys")
      .set("authorization", `Bearer ${adminSecret}`)
      .send({ clientId: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_request");
  });

  it("DELETE /v1/keys/{id} revokes the key and returns 204", async () => {
    const create = await supertest(app.server)
      .post("/v1/keys")
      .set("authorization", `Bearer ${adminSecret}`)
      .send({ clientId: "keys-child", label: "keys-child" });
    const revoke = await supertest(app.server)
      .delete(`/v1/keys/${create.body.keyId}`)
      .set("authorization", `Bearer ${adminSecret}`);
    expect(revoke.status).toBe(204);

    const attempt = await supertest(app.server)
      .get("/v1/keys")
      .set("authorization", `Bearer ${create.body.secret}`);
    expect(attempt.status).toBe(401);
  });
});
