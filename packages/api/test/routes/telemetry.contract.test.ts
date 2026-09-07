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

gated("contract: /v1/telemetry endpoints", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let secret: string;
  let writer: TelemetryWriter;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
    await db.deleteFrom("api_keys").where("label", "=", "telemetry-contract").execute();

    const registry = createRegistry();
    registry.register(createMockAdapter({ providerId: "mock-cheap" }));

    const created = await createApiKey(db, {
      clientId: "telemetry-contract",
      label: "telemetry-contract",
    });
    secret = created.secret;

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

  // T065 — /v1/telemetry/events
  it("GET /v1/telemetry/events returns 401 without auth", async () => {
    const res = await supertest(app.server).get("/v1/telemetry/events");
    expect(res.status).toBe(401);
  });

  it("GET /v1/telemetry/events returns {events, nextCursor} on 200", async () => {
    const res = await supertest(app.server)
      .get("/v1/telemetry/events?limit=5")
      .set("authorization", `Bearer ${secret}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect("nextCursor" in res.body).toBe(true);
  });

  // T066 — /v1/telemetry/rollups
  it("GET /v1/telemetry/rollups returns 401 without auth", async () => {
    const res = await supertest(app.server).get("/v1/telemetry/rollups");
    expect(res.status).toBe(401);
  });

  it("GET /v1/telemetry/rollups returns an array on 200", async () => {
    const res = await supertest(app.server)
      .get("/v1/telemetry/rollups")
      .set("authorization", `Bearer ${secret}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // T067 — /v1/telemetry/replay/{eventId}
  it("GET /v1/telemetry/replay/{id} returns 401 without auth", async () => {
    const res = await supertest(app.server).get(
      "/v1/telemetry/replay/00000000-0000-0000-0000-000000000000",
    );
    expect(res.status).toBe(401);
  });

  it("GET /v1/telemetry/replay/{missing-id} returns 404", async () => {
    const res = await supertest(app.server)
      .get("/v1/telemetry/replay/00000000-0000-0000-0000-000000000000")
      .set("authorization", `Bearer ${secret}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("event_not_found");
  });
});
