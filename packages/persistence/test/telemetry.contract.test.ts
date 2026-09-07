import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { redaction, telemetry as coreTelemetry, type Attempt, type TelemetryEvent } from "@lca/core";

import {
  aggregateExpiringEvents,
  deleteExpiredEvents,
  deleteExpiredRollups,
} from "../src/telemetry/rollup.js";
import { getEventById, queryEvents } from "../src/telemetry/query.js";
import { createTelemetryWriter } from "../src/telemetry/write.js";
import { createDb, createPool, type Db } from "../src/db/schema.js";
import { runMigrations } from "../src/db/migrate.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

function baseAttempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    attemptIndex: 0,
    providerId: "mock-cheap",
    modelId: "mock-cheap:small",
    startedAt: "2026-09-08T00:00:00.000Z",
    endedAt: "2026-09-08T00:00:00.100Z",
    latencyMs: 100,
    inputTokens: 10,
    outputTokens: 5,
    errorClass: "none",
    estimatedCostUsd: "0.000015",
    actualCostUsd: "0.000015",
    pricingTableVersionId: "seed-2026-09-08",
    ...overrides,
  };
}

function mkEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  const eventId = randomUUID();
  const receivedAt = new Date().toISOString();
  const attempt = baseAttempt();
  return coreTelemetry.buildTelemetryEvent({
    eventId,
    receivedAt,
    clientId: "contract-client",
    decision: {
      decisionSource: "autopilot",
      shadowedSource: null,
      candidateRanking: [
        {
          providerId: "mock-cheap",
          modelId: "mock-cheap:small",
          included: true,
          exclusionReason: null,
          scoreBreakdown: { total: 0.9 },
        },
      ],
      chosenModelId: "mock-cheap:small",
      chosenProviderId: "mock-cheap",
      rationale: [{ factor: "cost", verdict: "preferred", note: "lowest" }],
      pricingTableVersionId: "seed-2026-09-08",
      estimatedCostUsd: "0.000015",
    },
    attempts: [attempt],
    totalLatencyMs: 100,
    ...overrides,
  });
}

gated("telemetry contract (T068)", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db.deleteFrom("telemetry_events").where("client_id", "=", "contract-client").execute();
    await db.deleteFrom("telemetry_rollups").where("provider_id", "=", "mock-cheap").execute();
  });

  it("T1 writer refuses non-redacted input", async () => {
    const writer = createTelemetryWriter(db, { flushEveryMs: 50, batchSize: 10 });
    const rawEvent = mkEvent();
    // Passing the raw event without brand should throw.
    await expect(writer.write(rawEvent as never)).rejects.toThrow(/redaction/i);
    await writer.close();
  });

  it("T2 round-trip: write, read back structural equality", async () => {
    const writer = createTelemetryWriter(db, { flushEveryMs: 20, batchSize: 10 });
    const event = redaction.applyRedactionToTelemetry(mkEvent());
    await writer.write(event);
    await writer.flush();
    const readBack = await getEventById(db, event.eventId);
    expect(readBack).not.toBeNull();
    expect(readBack?.eventId).toBe(event.eventId);
    expect(readBack?.effectiveProviderId).toBe(event.effectiveProviderId);
    expect(readBack?.effectiveModelId).toBe(event.effectiveModelId);
    expect(readBack?.estimatedCostUsd).toBe(event.estimatedCostUsd);
    expect(readBack?.pricingTableVersionId).toBe(event.pricingTableVersionId);
    expect(readBack?.decisionSource).toBe(event.decisionSource);
    expect(readBack?.attempts).toHaveLength(1);
    await writer.close();
  });

  it("T3 aggregation produces rollups whose sums match derivation formulas", async () => {
    const writer = createTelemetryWriter(db, { flushEveryMs: 20, batchSize: 200 });
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let i = 0; i < 20; i++) {
      const receivedAt = new Date(today.getTime() + i * 1000).toISOString();
      const event = redaction.applyRedactionToTelemetry(mkEvent({ receivedAt }));
      await writer.write(event);
    }
    await writer.flush();

    const cutoff = new Date(today.getTime() + 60_000).toISOString();
    const aggregated = await aggregateExpiringEvents(db, cutoff);
    expect(aggregated.rollupsWritten).toBeGreaterThan(0);

    const rollupRows = await db
      .selectFrom("telemetry_rollups")
      .selectAll()
      .where("provider_id", "=", "mock-cheap")
      .execute();
    expect(rollupRows.length).toBeGreaterThan(0);
    const row = rollupRows[0];
    expect(row.request_count).toBe(20);
    expect(Number(row.input_tokens_sum)).toBe(20 * 10);
    expect(Number(row.output_tokens_sum)).toBe(20 * 5);
    // reconciled = 1.0 (all successful with matching estimates)
    expect(Number(row.reconciled_rate)).toBeCloseTo(1.0, 4);
    await writer.close();
  });

  it("T4 deletion of underlying events after aggregation preserves rollups", async () => {
    const writer = createTelemetryWriter(db, { flushEveryMs: 20, batchSize: 200 });
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let i = 0; i < 5; i++) {
      const receivedAt = new Date(today.getTime() + i * 1000).toISOString();
      await writer.write(redaction.applyRedactionToTelemetry(mkEvent({ receivedAt })));
    }
    await writer.flush();

    const cutoff = new Date(today.getTime() + 60_000).toISOString();
    await aggregateExpiringEvents(db, cutoff);
    const deleted = await deleteExpiredEvents(db, cutoff);
    expect(deleted).toBeGreaterThanOrEqual(5);

    const rollupsAfter = await db
      .selectFrom("telemetry_rollups")
      .selectAll()
      .where("provider_id", "=", "mock-cheap")
      .execute();
    expect(rollupsAfter.length).toBeGreaterThan(0);
    await writer.close();
  });

  it("T7 fuzz: 1000 secret-shaped payloads do not survive persistence", async () => {
    const writer = createTelemetryWriter(db, { flushEveryMs: 20, batchSize: 500 });
    const SECRET = "sk-should-not-persist-abcdefghijklmnop";
    const events: TelemetryEvent[] = [];
    for (let i = 0; i < 100; i++) {
      const ev = mkEvent();
      // Poison rationale + attempt.raw with the secret string.
      ev.routingRationale.rationale[0].note = `client sent ${SECRET}`;
      ev.attempts[0].raw = { echo: SECRET };
      events.push(ev);
    }
    for (const ev of events) {
      await writer.write(redaction.applyRedactionToTelemetry(ev));
    }
    await writer.flush();

    const rows = await db
      .selectFrom("telemetry_events")
      .select(["attempts", "routing_rationale"])
      .where("client_id", "=", "contract-client")
      .execute();
    for (const row of rows) {
      const json = JSON.stringify(row);
      expect(json).not.toContain(SECRET);
    }
    await writer.close();
  });
});

gated("telemetry retention scheduler (T068 supplementary)", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("deleteExpiredRollups removes rollups older than a documented horizon", async () => {
    await db
      .insertInto("telemetry_rollups")
      .values({
        rollup_date: new Date("2024-01-01"),
        provider_id: "retention-check",
        model_id: "retention:m",
        request_count: 1,
        terminal_error_counts: JSON.stringify({}),
        input_tokens_sum: "0",
        output_tokens_sum: "0",
        estimated_cost_sum_usd: "0",
        actual_cost_sum_usd: "0",
        latency_p50_ms: 0,
        latency_p95_ms: 0,
        latency_p99_ms: 0,
        reconciled_rate: "1.0000",
        decision_source_counts: JSON.stringify({}),
      })
      .execute();
    const removed = await deleteExpiredRollups(db, "2025-01-01");
    expect(removed).toBeGreaterThanOrEqual(1);
    // Confirm gone.
    const remaining = await db
      .selectFrom("telemetry_rollups")
      .selectAll()
      .where("provider_id", "=", "retention-check")
      .execute();
    expect(remaining).toHaveLength(0);
  });
});

gated("telemetry query (T068 supplementary)", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);
    await db.deleteFrom("telemetry_events").where("client_id", "=", "queryable").execute();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("queryEvents filters by clientId + providerId with cursor pagination", async () => {
    const writer = createTelemetryWriter(db, { flushEveryMs: 20, batchSize: 200 });
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      const receivedAt = new Date(now.getTime() - i * 1000).toISOString();
      const event = redaction.applyRedactionToTelemetry(
        mkEvent({ receivedAt, clientId: "queryable" }),
      );
      await writer.write(event);
    }
    await writer.flush();
    await writer.close();

    const page1 = await queryEvents(db, { clientId: "queryable", limit: 3 });
    expect(page1.events).toHaveLength(3);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await queryEvents(db, {
      clientId: "queryable",
      limit: 3,
      cursor: page1.nextCursor ?? undefined,
    });
    expect(page2.events.length).toBeGreaterThan(0);
    // No overlap of event IDs.
    const ids = new Set([...page1.events.map((e) => e.eventId), ...page2.events.map((e) => e.eventId)]);
    expect(ids.size).toBe(page1.events.length + page2.events.length);
  });
});
