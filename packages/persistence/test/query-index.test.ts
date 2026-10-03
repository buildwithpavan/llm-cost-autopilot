import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";

import { queryEvents } from "../src/telemetry/query.js";
import { createDb, createPool, type Db } from "../src/db/schema.js";
import { runMigrations } from "../src/db/migrate.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

const PRICING = "qidx-test-pricing";
const CLIENT = "qidx-order";
// Two events share a timestamp so the (received_at DESC, event_id DESC) tiebreak is exercised.
const SHARED = "2026-10-02T10:00:00.000Z";

function evRow(eventId: string, receivedAt: string) {
  return {
    event_id: eventId,
    received_at: receivedAt,
    client_id: CLIENT,
    decision_source: "autopilot" as const,
    shadowed_source: null,
    effective_provider_id: "mock-cheap",
    effective_model_id: "mock-cheap:small",
    attempts: JSON.stringify([]),
    aggregated_input_tokens: 10,
    aggregated_output_tokens: 5,
    total_latency_ms: 100,
    terminal_error_class: "none",
    estimated_cost_usd: "0.000010",
    actual_cost_usd: null,
    pricing_table_version_id: PRICING,
    reconciled: null,
    routing_rationale: JSON.stringify({}),
  };
}

gated("telemetry_events time index + ordering (Phase 17)", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db
      .insertInto("pricing_tables")
      .values({ version_id: PRICING, effective_from: new Date(), is_active: false })
      .execute();
    await db
      .insertInto("telemetry_events")
      .values([
        evRow("00000000-0000-4000-8000-000000000001", "2026-10-01T08:00:00.000Z"),
        evRow("00000000-0000-4000-8000-00000000000a", SHARED),
        evRow("00000000-0000-4000-8000-00000000000b", SHARED),
        evRow("00000000-0000-4000-8000-000000000002", "2026-10-03T09:00:00.000Z"),
      ])
      .execute();
  });

  afterAll(async () => {
    await db.deleteFrom("telemetry_events").where("client_id", "=", CLIENT).execute();
    await db.deleteFrom("pricing_tables").where("version_id", "=", PRICING).execute();
    await db.destroy();
  });

  it("has the received_at-leading index that backs unfiltered recent-events reads", async () => {
    const res = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM pg_class WHERE relname = 'telemetry_events_received_at'
      ) AS exists
    `.execute(db);
    expect(res.rows[0]?.exists).toBe(true);
  });

  it("returns events in deterministic (received_at DESC, event_id DESC) order", async () => {
    const page = await queryEvents(db, {
      clientId: CLIENT,
      since: "2026-10-01T00:00:00.000Z",
      until: "2026-10-04T00:00:00.000Z",
      limit: 10,
    });
    expect(page.events.map((e) => e.eventId)).toEqual([
      "00000000-0000-4000-8000-000000000002", // 10-03
      "00000000-0000-4000-8000-00000000000b", // 10-02 shared, higher event_id first
      "00000000-0000-4000-8000-00000000000a", // 10-02 shared
      "00000000-0000-4000-8000-000000000001", // 10-01
    ]);
  });

  it("paginates deterministically via the cursor without gaps or overlap", async () => {
    const first = await queryEvents(db, { clientId: CLIENT, limit: 2 });
    expect(first.events).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = await queryEvents(db, { clientId: CLIENT, limit: 2, cursor: first.nextCursor! });
    const ids = [...first.events, ...second.events].map((e) => e.eventId);
    expect(new Set(ids).size).toBe(ids.length); // no overlap
    expect(ids).toEqual([
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-00000000000b",
      "00000000-0000-4000-8000-00000000000a",
      "00000000-0000-4000-8000-000000000001",
    ]);
  });
});
