import { randomUUID } from "node:crypto";

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

gated("US2 telemetry acceptance", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let apiKeySecret: string;
  let writer: TelemetryWriter;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);

    await db.deleteFrom("api_keys").where("label", "=", "us2-integ").execute();
    await db.deleteFrom("telemetry_events").where("client_id", "=", "us2-integ").execute();
    await setProviderHealth(db, "mock-cheap", true, 0);
    await setProviderHealth(db, "mock-fast", true, 0);

    const registry = createRegistry();
    registry.register(createMockAdapter({ providerId: "mock-cheap" }));
    registry.register(createMockAdapter({ providerId: "mock-fast" }));

    const created = await createApiKey(db, { clientId: "us2-integ", label: "us2-integ" });
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

  async function completeAndWait(payload: unknown, xRequestId?: string) {
    const req = supertest(app.server)
      .post("/v1/completions")
      .set("authorization", `Bearer ${apiKeySecret}`);
    if (xRequestId) req.set("x-request-id", xRequestId);
    const res = await req.send(payload);
    // Give the writer a tick to flush (batchSize=1 flushes immediately).
    await new Promise((r) => setTimeout(r, 50));
    return res;
  }

  it("writes a full-fidelity telemetry event with every FR-020 field", async () => {
    const res = await completeAndWait({ messages: [{ role: "user", content: "hello" }] });
    expect(res.status).toBe(200);
    const eventId = res.body.requestId;
    const list = await supertest(app.server)
      .get(`/v1/telemetry/events?clientId=us2-integ&limit=5`)
      .set("authorization", `Bearer ${apiKeySecret}`);
    expect(list.status).toBe(200);
    const found = list.body.events.find((e: { eventId: string }) => e.eventId === eventId);
    expect(found).toBeTruthy();
    expect(found.pricingTableVersionId).toMatch(/^seed-/);
    expect(found.decisionSource).toBe("autopilot");
    expect(found.effectiveProviderId).toMatch(/^mock-/);
    expect(found.effectiveModelId).toBeTruthy();
    expect(found.attempts.length).toBeGreaterThanOrEqual(1);
    expect(found.routingRationale.candidateRanking.length).toBeGreaterThanOrEqual(1);
    expect(found.terminalErrorClass).toBe("none");
    expect(found.reconciled).toBe(true);
  });

  it("T109: correlation ID round-trips from x-request-id → response header → telemetry.eventId", async () => {
    const cid = randomUUID();
    const res = await completeAndWait(
      { messages: [{ role: "user", content: "correlate me" }] },
      cid,
    );
    expect(res.status).toBe(200);
    expect(res.headers["x-request-id"]).toBe(cid);
    expect(res.body.requestId).toBe(cid);

    const list = await supertest(app.server)
      .get(`/v1/telemetry/events?clientId=us2-integ&limit=5`)
      .set("authorization", `Bearer ${apiKeySecret}`);
    const found = list.body.events.find((e: { eventId: string }) => e.eventId === cid);
    expect(found).toBeTruthy();
    expect(found.eventId).toBe(cid);
  });

  it("replay reproduces the recorded routing decision without calling any provider", async () => {
    const res = await completeAndWait({
      messages: [{ role: "user", content: "reproduce me" }],
    });
    expect(res.status).toBe(200);
    const eventId = res.body.requestId;
    const replay = await supertest(app.server)
      .get(`/v1/telemetry/replay/${eventId}`)
      .set("authorization", `Bearer ${apiKeySecret}`);
    expect(replay.status).toBe(200);
    expect(replay.body.matches).toBe(true);
    expect(replay.body.replayed.chosenProviderId).toBe(replay.body.recorded.chosenProviderId);
    expect(replay.body.replayed.chosenModelId).toBe(replay.body.recorded.chosenModelId);
  });

  it("telemetry contains no unredacted secret-shaped payloads", async () => {
    const secret = "sk-should-not-persist-abcdefghijklmnop";
    await completeAndWait({
      messages: [{ role: "user", content: `please ignore: ${secret}` }],
    });
    const rows = await db
      .selectFrom("telemetry_events")
      .select(["attempts", "routing_rationale"])
      .where("client_id", "=", "us2-integ")
      .execute();
    for (const row of rows) {
      const json = JSON.stringify(row);
      expect(json).not.toContain(secret);
    }
  });

  it("returns 404 for replay when the event does not exist", async () => {
    const res = await supertest(app.server)
      .get(`/v1/telemetry/replay/${randomUUID()}`)
      .set("authorization", `Bearer ${apiKeySecret}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("event_not_found");
  });

  it("GET /v1/telemetry/rollups returns an array (may be empty)", async () => {
    const res = await supertest(app.server)
      .get(`/v1/telemetry/rollups`)
      .set("authorization", `Bearer ${apiKeySecret}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
