import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";

import {
  createBudgetStore,
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

gated("/metrics exposes budget gauges without high-cardinality labels", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let writer: TelemetryWriter;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
    const registry = createRegistry();
    registry.register(createMockAdapter({ providerId: "mock-cheap" }));
    writer = createTelemetryWriter(db, { batchSize: 1, flushEveryMs: 0 });
    app = await buildServer({
      config: loadConfig({ ...process.env, DATABASE_URL }),
      db,
      registry,
      telemetryWriter: writer,
      budgetStore: createBudgetStore(db),
    });
    await app.ready();
  });

  afterAll(async () => {
    await writer.close();
    await app.close();
    await db.destroy();
  });

  it("registers lca_budget_utilization and lca_budget_alert_active with no client/budget labels", async () => {
    const res = await supertest(app.server).get("/metrics");
    expect(res.status).toBe(200);
    const body = res.text;
    expect(body).toContain("lca_budget_utilization");
    expect(body).toContain("lca_budget_alert_active");
    // Sample lines must carry no label set (no `{...}`) → bounded cardinality.
    expect(body).toMatch(/^lca_budget_utilization \d/m);
    expect(body).toMatch(/^lca_budget_alert_active [01]/m);
    const labelled = body
      .split("\n")
      .filter((l) => /^lca_budget_(utilization|alert_active)\{/.test(l));
    expect(labelled).toEqual([]);
    expect(body).not.toMatch(/lca_budget_[a-z_]+\{[^}]*(client|budget)/i);
  });
});
