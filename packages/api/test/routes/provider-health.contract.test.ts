import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import type { ProviderAdapter } from "@lca/providers";

import { buildServer } from "../../src/server.js";
import { loadConfig } from "../../src/config.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

gated("contract: /v1/health/providers", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let secret: string;
  let writer: TelemetryWriter;
  let probeCount = 0;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
    await db.deleteFrom("api_keys").where("label", "=", "provider-health-contract").execute();

    // Spy on probeHealth to prove the endpoint never triggers a live probe.
    const base = createMockAdapter({ providerId: "mock-cheap" });
    const spied: ProviderAdapter = {
      ...base,
      probeHealth: (signal?: AbortSignal) => {
        probeCount += 1;
        return base.probeHealth(signal);
      },
    };
    const registry = createRegistry();
    registry.register(spied);
    registry.register(createMockAdapter({ providerId: "mock-fast" }));

    const created = await createApiKey(db, {
      clientId: "provider-health-contract",
      label: "provider-health-contract",
    });
    secret = created.secret;

    writer = createTelemetryWriter(db, { batchSize: 1, flushEveryMs: 0 });
    const config = loadConfig({ ...process.env, DATABASE_URL });
    app = await buildServer({ config, db, registry, telemetryWriter: writer });
    await app.ready();
  });

  afterAll(async () => {
    // Restore health for other suites that share this database.
    await setProviderHealth(db, "mock-cheap", true, 0);
    await setProviderHealth(db, "mock-fast", true, 0);
    await writer.close();
    await app.close();
    await db.destroy();
  });

  beforeEach(async () => {
    probeCount = 0;
    // A healthy provider and an unhealthy one with a real failure streak.
    await setProviderHealth(db, "mock-cheap", true, 0);
    await setProviderHealth(db, "mock-fast", false, 4);
  });

  it("returns 401 without auth", async () => {
    const res = await supertest(app.server).get("/v1/health/providers");
    expect(res.status).toBe(401);
  });

  it("returns persisted provider health on 200 with auth", async () => {
    const res = await supertest(app.server)
      .get("/v1/health/providers")
      .set("authorization", `Bearer ${secret}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const byId = new Map<string, Record<string, unknown>>(
      (res.body as Array<Record<string, unknown>>).map((s) => [s["providerId"] as string, s]),
    );

    const healthy = byId.get("mock-cheap")!;
    expect(healthy["healthy"]).toBe(true);
    expect(healthy["consecutiveFailures"]).toBe(0);
    expect(typeof healthy["lastProbedAt"]).toBe("string");
    expect(Number.isNaN(Date.parse(healthy["lastProbedAt"] as string))).toBe(false);

    const unhealthy = byId.get("mock-fast")!;
    expect(unhealthy["healthy"]).toBe(false);
    expect(unhealthy["consecutiveFailures"]).toBe(4);
    expect(typeof unhealthy["lastProbedAt"]).toBe("string");
  });

  it("exposes only the four public health fields (no secrets/endpoints/credentials)", async () => {
    const res = await supertest(app.server)
      .get("/v1/health/providers")
      .set("authorization", `Bearer ${secret}`);
    for (const state of res.body as Array<Record<string, unknown>>) {
      expect(Object.keys(state).sort()).toEqual([
        "consecutiveFailures",
        "healthy",
        "lastProbedAt",
        "providerId",
      ]);
    }
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("baseUrl");
    expect(serialized).not.toContain("endpoint");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("authorization");
  });

  it("does not trigger provider probes", async () => {
    await supertest(app.server).get("/v1/health/providers").set("authorization", `Bearer ${secret}`);
    expect(probeCount).toBe(0);
  });

  it("leaves GET /v1/health public and unchanged", async () => {
    const res = await supertest(app.server).get("/v1/health");
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty("status");
    expect(res.body).toHaveProperty("checks");
    expect(res.body).not.toHaveProperty("providers");
  });
});
