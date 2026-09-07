import { describe, expect, it } from "vitest";

import type {
  RedactedTelemetryEvent} from "../src/redaction/apply.js";
import {
  applyRedaction,
  applyRedactionToTelemetry,
  assertRedacted,
} from "../src/redaction/apply.js";
import type { TelemetryEvent } from "../src/types/telemetry.js";

const SAMPLE_TELEMETRY: TelemetryEvent = {
  eventId: "01924b1a-4c9f-7000-b000-000000000001",
  receivedAt: "2026-09-08T00:00:00.000Z",
  clientId: "client-1",
  decisionSource: "autopilot",
  shadowedSource: null,
  effectiveProviderId: "mock-cheap",
  effectiveModelId: "mock-cheap:small",
  attempts: [
    {
      attemptIndex: 0,
      providerId: "mock-cheap",
      modelId: "mock-cheap:small",
      startedAt: "2026-09-08T00:00:00.000Z",
      endedAt: "2026-09-08T00:00:00.100Z",
      latencyMs: 100,
      inputTokens: 10,
      outputTokens: 5,
      errorClass: "none",
      estimatedCostUsd: "0.000005",
      actualCostUsd: "0.000005",
      pricingTableVersionId: "seed-2026-09-08",
    },
  ],
  aggregatedInputTokens: 10,
  aggregatedOutputTokens: 5,
  totalLatencyMs: 100,
  terminalErrorClass: "none",
  estimatedCostUsd: "0.000005",
  actualCostUsd: "0.000005",
  pricingTableVersionId: "seed-2026-09-08",
  reconciled: true,
  routingRationale: {
    decisionSource: "autopilot",
    shadowedSource: null,
    candidateRanking: [],
    chosenModelId: "mock-cheap:small",
    chosenProviderId: "mock-cheap",
    rationale: [{ factor: "cost", verdict: "preferred", note: "lowest cost candidate" }],
    pricingTableVersionId: "seed-2026-09-08",
    estimatedCostUsd: "0.000005",
  },
};

describe("redaction rules", () => {
  it("redacts OpenAI-style secrets", () => {
    const out = applyRedaction("call sk-abcdef1234567890abcdef1234567890 twice");
    expect(out).not.toContain("sk-abcdef1234567890abcdef1234567890");
    expect(out).toContain("[REDACTED:secret]");
  });

  it("redacts bearer tokens", () => {
    const out = applyRedaction("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9.payload.sig");
    expect(out).toContain("[REDACTED:secret]");
  });

  it("redacts api_key= assignments", () => {
    const out = applyRedaction("query?api_key=abcd1234abcd1234abcd1234abcd1234");
    expect(out).not.toContain("abcd1234abcd1234abcd1234abcd1234");
    expect(out).toContain("[REDACTED:secret]");
  });

  it("redacts email addresses", () => {
    const out = applyRedaction("email me at alice.smith@example.com please");
    expect(out).not.toContain("alice.smith@example.com");
    expect(out).toContain("[REDACTED:pii]");
  });

  it("redacts phone numbers", () => {
    const out = applyRedaction("call 415-555-0198 tomorrow");
    expect(out).not.toContain("415-555-0198");
    expect(out).toContain("[REDACTED:pii]");
  });

  it("redacts credit-card-shaped digits", () => {
    const out = applyRedaction("card 4111 1111 1111 1111 attached");
    expect(out).not.toContain("4111 1111 1111 1111");
    expect(out).toContain("[REDACTED:pii]");
  });

  it("truncates strings longer than 512 chars and marks them", () => {
    const long = "x".repeat(1024);
    const out = applyRedaction(long);
    expect(out.length).toBeLessThanOrEqual(512 + "…[truncated]".length);
    expect(out).toContain("…[truncated]");
  });

  it("does not mutate the input event", () => {
    const clone = structuredClone(SAMPLE_TELEMETRY);
    applyRedactionToTelemetry(SAMPLE_TELEMETRY);
    expect(SAMPLE_TELEMETRY).toEqual(clone);
  });

  it("produces a RedactedTelemetryEvent brand", () => {
    const out = applyRedactionToTelemetry(SAMPLE_TELEMETRY);
    // brand assertion should not throw
    expect(() => assertRedacted(out)).not.toThrow();
    // raw event should be rejected by the brand guard
    expect(() =>
      assertRedacted(SAMPLE_TELEMETRY as unknown as RedactedTelemetryEvent),
    ).toThrow();
  });
});
