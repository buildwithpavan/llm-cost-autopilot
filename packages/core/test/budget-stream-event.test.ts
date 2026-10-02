import { describe, expect, it } from "vitest";

import { telemetryStreamEventSchema } from "../src/types/telemetry-stream.js";

const base = {
  seq: 5,
  eventType: "budget.evaluated" as const,
  eventId: "11111111-1111-1111-1111-111111111111",
  clientId: "acme",
  timestamp: "2026-10-02T00:00:00.000Z",
  decision: "blocked" as const,
  requestEstimatedCostUsd: "0.001234",
  applicableBudgetIds: ["budget_a"],
  blockedBudgetIds: ["budget_a"],
  evaluations: [
    {
      budgetId: "budget_a",
      scope: "client" as const,
      clientId: "acme",
      period: "daily" as const,
      action: "block" as const,
      decision: "block" as const,
      currentSpendUsd: "1.000000",
      projectedSpendUsd: "1.001234",
      limitUsd: "1.000000",
      remainingUsd: "-0.001234",
    },
  ],
};

describe("budget.evaluated stream event schema", () => {
  it("accepts a well-formed blocked audit event", () => {
    const parsed = telemetryStreamEventSchema.parse(base);
    expect(parsed.eventType).toBe("budget.evaluated");
  });

  it("accepts a warned audit event", () => {
    expect(() => telemetryStreamEventSchema.parse({ ...base, decision: "warned" })).not.toThrow();
  });

  it("rejects an invalid decision value", () => {
    expect(() => telemetryStreamEventSchema.parse({ ...base, decision: "allowed" })).toThrow();
  });

  it("requires decimal-string cost fields", () => {
    expect(() => telemetryStreamEventSchema.parse({ ...base, requestEstimatedCostUsd: 0.001234 })).toThrow();
  });
});
