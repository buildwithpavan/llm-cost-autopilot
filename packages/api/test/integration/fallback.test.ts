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

gated("fallback integration (T095)", () => {
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
    await db.deleteFrom("api_keys").where("label", "=", "fallback-integ").execute();
    await db.deleteFrom("telemetry_events").where("client_id", "=", "fallback-integ").execute();
    await setProviderHealth(db, "mock-cheap", true, 0);
    await setProviderHealth(db, "mock-fast", true, 0);

    // Primary (chosen by cost) always fails with 5xx; fallback (mock-fast) succeeds.
    const registry = createRegistry();
    registry.register(
      createMockAdapter({ providerId: "mock-cheap", failFirstWith: "upstream_5xx" }),
    );
    registry.register(createMockAdapter({ providerId: "mock-fast" }));

    const created = await createApiKey(db, {
      clientId: "fallback-integ",
      label: "fallback-integ",
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
    await writer.close();
    await app.close();
    await db.destroy();
  });

  it("recovers via one fallback on upstream_5xx and records both attempts", async () => {
    const cid = randomUUID();
    const res = await supertest(app.server)
      .post("/v1/completions")
      .set("authorization", `Bearer ${apiKeySecret}`)
      .set("x-request-id", cid)
      .send({ messages: [{ role: "user", content: "please recover" }] });
    expect(res.status).toBe(200);
    // The fallback picks the next-ranked candidate, which may be a different
    // model on the same provider or a different provider entirely.
    expect(res.body.providerId).toBeTruthy();
    expect(res.body.modelId).not.toBe(res.body.decision.chosenModelId);

    await new Promise((r) => setTimeout(r, 100));

    const events = await supertest(app.server)
      .get(`/v1/telemetry/events?clientId=fallback-integ&limit=5`)
      .set("authorization", `Bearer ${apiKeySecret}`);
    const found = events.body.events.find(
      (e: { eventId: string }) => e.eventId === cid,
    );
    expect(found).toBeTruthy();
    expect(found.attempts).toHaveLength(2);
    expect(found.attempts[0].errorClass).toBe("upstream_5xx");
    expect(found.attempts[1].errorClass).toBe("none");
    expect(found.terminalErrorClass).toBe("none");
    // Effective provider/model must be from the fallback attempt.
    expect(found.effectiveProviderId).toBe(found.attempts[1].providerId);
    expect(found.effectiveModelId).toBe(found.attempts[1].modelId);
  });
});
