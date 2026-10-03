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

const CLIENT = "security-hardening";

gated("Phase 16 security hardening", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let secret: string;
  let writer: TelemetryWriter;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
    await db.deleteFrom("api_keys").where("label", "=", CLIENT).execute();
    const registry = createRegistry();
    registry.register(createMockAdapter({ providerId: "mock-cheap" }));
    const created = await createApiKey(db, { clientId: CLIENT, label: CLIENT });
    secret = created.secret;
    writer = createTelemetryWriter(db, { batchSize: 1, flushEveryMs: 0 });
    const config = loadConfig({ ...process.env, DATABASE_URL });
    app = await buildServer({ config, db, registry, telemetryWriter: writer });
    await app.ready();
  });

  afterAll(async () => {
    await writer.close();
    await app.close();
    await db.deleteFrom("api_keys").where("label", "=", CLIENT).execute();
    await db.destroy();
  });

  function auth(r: supertest.Test): supertest.Test {
    return r.set("authorization", `Bearer ${secret}`);
  }

  // ---- Security headers (helmet) -----------------------------------------

  it("sets hardened security headers on responses", async () => {
    const res = await supertest(app.server).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["referrer-policy"]).toBeDefined();
    // The API never advertises its framework.
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  // ---- Development CORS is restricted to loopback origins -----------------

  it("reflects a loopback origin but never an arbitrary external origin", async () => {
    const local = await supertest(app.server).get("/metrics").set("origin", "http://localhost:3100");
    expect(local.headers["access-control-allow-origin"]).toBe("http://localhost:3100");

    const evil = await supertest(app.server).get("/metrics").set("origin", "https://evil.example");
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
    expect(evil.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  // ---- Auth is enforced before any business logic ------------------------

  it("rejects unauthenticated access to a protected route with 401", async () => {
    const res = await supertest(app.server).get("/v1/telemetry/events");
    expect(res.status).toBe(401);
  });

  // ---- Malformed query params are rejected deterministically (400) -------

  it("rejects a non-numeric limit with 400 instead of a 500", async () => {
    const res = await auth(supertest(app.server).get("/v1/telemetry/events?limit=abc"));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_request");
  });

  it("rejects a zero/negative limit with 400", async () => {
    expect((await auth(supertest(app.server).get("/v1/telemetry/events?limit=0"))).status).toBe(400);
    expect((await auth(supertest(app.server).get("/v1/telemetry/events?limit=-3"))).status).toBe(400);
  });

  it("rejects a malformed since/until date with 400", async () => {
    expect((await auth(supertest(app.server).get("/v1/telemetry/events?since=not-a-date"))).status).toBe(400);
    expect((await auth(supertest(app.server).get("/v1/telemetry/events?until=nope"))).status).toBe(400);
  });

  it("rejects malformed rollups fromDate/toDate with 400", async () => {
    expect((await auth(supertest(app.server).get("/v1/telemetry/rollups?fromDate=bad"))).status).toBe(400);
    expect((await auth(supertest(app.server).get("/v1/telemetry/rollups?toDate=also-bad"))).status).toBe(400);
  });

  it("rejects a non-numeric budget-decisions limit with 400", async () => {
    const res = await auth(supertest(app.server).get("/v1/telemetry/budget-decisions?limit=NaN"));
    expect(res.status).toBe(400);
  });

  // ---- Valid bounded requests still succeed ------------------------------

  it("accepts a valid limit and date window", async () => {
    const res = await auth(
      supertest(app.server).get(`/v1/telemetry/events?clientId=${CLIENT}&limit=5`),
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  it("accepts a large limit (clamped downstream, not rejected)", async () => {
    const res = await auth(supertest(app.server).get("/v1/telemetry/events?limit=1000000"));
    expect(res.status).toBe(200);
  });
});
