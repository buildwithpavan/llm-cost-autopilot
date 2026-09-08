import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  applyRedactionToTelemetry,
  MAX_LENGTH,
  RULES,
} from "../src/redaction/index.js";
import type { TelemetryEvent } from "../src/types/telemetry.js";

const N = 1_000;

const SAMPLE_EVENT: TelemetryEvent = {
  eventId: "01924b1a-4c9f-7000-b000-000000000001",
  receivedAt: "2026-09-08T00:00:00.000Z",
  clientId: "fuzz-client",
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
      estimatedCostUsd: "0.000015",
      actualCostUsd: "0.000015",
      pricingTableVersionId: "seed-v1",
    },
  ],
  aggregatedInputTokens: 10,
  aggregatedOutputTokens: 5,
  totalLatencyMs: 100,
  terminalErrorClass: "none",
  estimatedCostUsd: "0.000015",
  actualCostUsd: "0.000015",
  pricingTableVersionId: "seed-v1",
  reconciled: true,
  routingRationale: {
    decisionSource: "autopilot",
    shadowedSource: null,
    candidateRanking: [],
    chosenModelId: "mock-cheap:small",
    chosenProviderId: "mock-cheap",
    rationale: [{ factor: "cost", verdict: "preferred", note: "" }],
    pricingTableVersionId: "seed-v1",
    estimatedCostUsd: "0.000015",
  },
};

/** Generators for each redaction category. Each returns [secret, poisonedString]. */
const GENERATORS: Array<() => { secret: string; carrier: string }> = [
  // OpenAI-style secret keys
  () => {
    const s = `sk-${randomBytes(16).toString("hex")}`;
    return { secret: s, carrier: `The user typed ${s} into chat` };
  },
  // Anthropic-style
  () => {
    const s = `sk-ant-${randomBytes(16).toString("hex")}`;
    return { secret: s, carrier: `key=${s}` };
  },
  // Bearer tokens
  () => {
    const s = randomBytes(20).toString("base64url");
    return { secret: s, carrier: `Bearer ${s}` };
  },
  // api_key= assignment
  () => {
    const s = randomBytes(16).toString("hex");
    return { secret: s, carrier: `?api_key=${s}` };
  },
  // Emails
  () => {
    const local = randomBytes(6).toString("hex");
    const s = `${local}@example.org`;
    return { secret: s, carrier: `contact ${s} please` };
  },
  // Phone
  () => {
    const three = 100 + (randomBytes(1)[0]! % 900);
    const four = 1000 + (randomBytes(2).readUInt16BE(0) % 9000);
    const s = `415-${three}-${four}`;
    return { secret: s, carrier: `call ${s} soon` };
  },
  // Credit-card-like digit runs (16)
  () => {
    const digits = Array.from({ length: 16 }, () => randomBytes(1)[0]! % 10).join("");
    const spaced = digits.match(/.{4}/g)!.join(" ");
    return { secret: spaced, carrier: `card: ${spaced}` };
  },
];

describe("redaction fuzz (T100, 1000 payloads)", () => {
  it("no generated secret survives in the redacted event JSON", () => {
    const secrets: string[] = [];
    for (let i = 0; i < N; i++) {
      const gen = GENERATORS[i % GENERATORS.length]!();
      secrets.push(gen.secret);
      // Poison every string leaf touched during persistence.
      const ev = structuredClone(SAMPLE_EVENT);
      ev.routingRationale.rationale[0]!.note = `client sent ${gen.carrier}`;
      (ev.attempts[0] as { raw?: unknown }).raw = { echo: gen.carrier };
      ev.clientId = `${ev.clientId}-${i}`;
      const redacted = applyRedactionToTelemetry(ev);
      const json = JSON.stringify(redacted);
      expect(json.includes(gen.secret)).toBe(false);
    }
    expect(secrets).toHaveLength(N);
  });

  it("truncates arbitrarily long string leaves to MAX_LENGTH", () => {
    const long = "x".repeat(4096);
    const ev = structuredClone(SAMPLE_EVENT);
    (ev.attempts[0] as { raw?: unknown }).raw = { blob: long };
    const redacted = applyRedactionToTelemetry(ev);
    const jsonLen = JSON.stringify(redacted).length;
    // Every string is capped, so the persisted JSON cannot contain a 4096-x run.
    expect(jsonLen).toBeLessThan(long.length);
    const attemptRaw = (redacted.attempts[0] as { raw?: { blob?: string } }).raw;
    expect(attemptRaw?.blob?.length ?? 0).toBeLessThanOrEqual(MAX_LENGTH + 20);
  });

  it("preserves the RULES export for downstream introspection", () => {
    expect(RULES.length).toBeGreaterThan(0);
    for (const r of RULES) {
      expect(["secret", "pii"]).toContain(r.kind);
      expect(r.pattern).toBeInstanceOf(RegExp);
    }
  });
});
