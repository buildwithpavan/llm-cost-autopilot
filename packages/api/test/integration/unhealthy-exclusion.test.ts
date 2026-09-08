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

gated("unhealthy provider exclusion (T110 / FR-029)", () => {
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
    await db
      .deleteFrom("api_keys")
      .where("label", "=", "unhealthy-exclusion")
      .execute();

    const registry = createRegistry();
    registry.register(createMockAdapter({ providerId: "mock-cheap" }));
    registry.register(createMockAdapter({ providerId: "mock-fast" }));

    // Mark mock-cheap UNHEALTHY; mock-fast healthy.
    await setProviderHealth(db, "mock-cheap", false, 3);
    await setProviderHealth(db, "mock-fast", true, 0);

    const created = await createApiKey(db, {
      clientId: "unhealthy-exclusion",
      label: "unhealthy-exclusion",
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
    // Restore health for other suites.
    await setProviderHealth(db, "mock-cheap", true, 0);
    await writer.close();
    await app.close();
    await db.destroy();
  });

  it("unhealthy provider's models are absent from the catalog and never chosen", async () => {
    const res = await supertest(app.server)
      .post("/v1/completions")
      .set("authorization", `Bearer ${apiKeySecret}`)
      .send({ messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
    expect(res.body.providerId).toBe("mock-fast");
    // No mock-cheap entry should appear in the ranking at all — the catalog
    // filter drops unhealthy providers before scoring.
    const rankingIds = (
      res.body.decision.candidateRanking as Array<{ providerId: string }>
    ).map((c) => c.providerId);
    expect(rankingIds).not.toContain("mock-cheap");
  });

  it("catalog endpoint mirrors the same filtering", async () => {
    const res = await supertest(app.server)
      .get("/v1/catalog")
      .set("authorization", `Bearer ${apiKeySecret}`);
    expect(res.status).toBe(200);
    const providerIds = (res.body.models as Array<{ providerId: string }>).map(
      (m) => m.providerId,
    );
    expect(providerIds).not.toContain("mock-cheap");
    expect(providerIds).toContain("mock-fast");
  });
});
