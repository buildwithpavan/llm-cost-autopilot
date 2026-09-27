import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";

import { createDb, createPool, type Db } from "../src/db/schema.js";
import { runMigrations } from "../src/db/migrate.js";
import { readProviderHealthStates } from "../src/health/probe.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const testSuite = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

// Distinct, self-scoped provider ids so we never clobber seeded/adapter providers.
const IDS = ["zzhealth-a", "zzhealth-b", "zzhealth-c"];

testSuite("readProviderHealthStates", () => {
  let pool: pg.Pool;
  let db: Db;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
  });

  afterAll(async () => {
    await db.deleteFrom("provider_health_state").where("provider_id", "in", IDS).execute();
    await db.destroy();
  });

  beforeEach(async () => {
    await db.deleteFrom("provider_health_state").where("provider_id", "in", IDS).execute();
  });

  it("maps rows to the ProviderHealthState shape, preserves timestamps, and orders by providerId asc", async () => {
    // Insert out of order to prove ordering is applied by the query.
    await db
      .insertInto("provider_health_state")
      .values([
        { provider_id: "zzhealth-b", healthy: false, last_probed_at: new Date("2026-01-02T03:04:05.000Z"), consecutive_failures: 3 },
        { provider_id: "zzhealth-a", healthy: true, last_probed_at: new Date("2026-01-01T00:00:00.000Z"), consecutive_failures: 0 },
        { provider_id: "zzhealth-c", healthy: true, last_probed_at: new Date("2026-01-03T09:10:11.000Z"), consecutive_failures: 7 },
      ])
      .execute();

    const states = (await readProviderHealthStates(db)).filter((s) => IDS.includes(s.providerId));

    expect(states.map((s) => s.providerId)).toEqual(["zzhealth-a", "zzhealth-b", "zzhealth-c"]);

    expect(states[0]).toEqual({
      providerId: "zzhealth-a",
      healthy: true,
      lastProbedAt: "2026-01-01T00:00:00.000Z",
      consecutiveFailures: 0,
    });
    // Unhealthy provider with a non-zero failure streak is preserved verbatim.
    expect(states[1]).toEqual({
      providerId: "zzhealth-b",
      healthy: false,
      lastProbedAt: "2026-01-02T03:04:05.000Z",
      consecutiveFailures: 3,
    });
    expect(states[2]!.consecutiveFailures).toBe(7);

    // Exactly the four public fields — no db/internal columns leak.
    expect(Object.keys(states[0]!).sort()).toEqual([
      "consecutiveFailures",
      "healthy",
      "lastProbedAt",
      "providerId",
    ]);
  });

  it("returns an empty array when no rows match", async () => {
    const states = (await readProviderHealthStates(db)).filter((s) => IDS.includes(s.providerId));
    expect(states).toEqual([]);
  });
});
