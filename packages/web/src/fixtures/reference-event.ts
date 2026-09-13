/**
 * Reference-match fixture — mirrors the Figma "02 Reference Match" values exactly.
 * Values were originally computed against the real routing formulas in
 * packages/core/src/routing/decide.ts, so this event is a legitimate output
 * of the backend and can be replaced by a live GET /v1/telemetry/events?limit=1
 * response without changing any component.
 */
import type { TelemetryEvent } from "../types/index.js";

export const REFERENCE_EVENT: TelemetryEvent = {
  eventId: "01H2K7XYZAB4CDEF9GHJKMNP08",
  receivedAt: "2026-09-07T10:24:18.482Z",
  clientId: "acme-corp",
  decisionSource: "autopilot",
  shadowedSource: null,
  effectiveProviderId: "openai",
  effectiveModelId: "gpt-4o-mini",
  attempts: [
    {
      attemptIndex: 0,
      providerId: "openai",
      modelId: "gpt-4o-mini",
      startedAt: "2026-09-07T10:24:18.524Z",
      endedAt: "2026-09-07T10:24:18.570Z",
      latencyMs: 46,
      inputTokens: 1200,
      outputTokens: 320,
      errorClass: "none",
      estimatedCostUsd: "0.000420",
      actualCostUsd: "0.000410",
      pricingTableVersionId: "pricing-v2024-10-01",
    },
  ],
  aggregatedInputTokens: 1200,
  aggregatedOutputTokens: 320,
  totalLatencyMs: 46,
  terminalErrorClass: "none",
  estimatedCostUsd: "0.000420",
  actualCostUsd: "0.000410",
  pricingTableVersionId: "pricing-v2024-10-01",
  reconciled: true,
  routingRationale: {
    decisionSource: "autopilot",
    shadowedSource: null,
    candidateRanking: [
      {
        providerId: "openai",
        modelId: "gpt-4o-mini",
        included: true,
        exclusionReason: null,
        scoreBreakdown: {
          costScore: 1.0,
          latencyScore: 0.333,
          qualityScore: 0.6,
          reliabilityScore: 0.998,
          capabilityScore: 1.0,
          total: 0.9131,
        },
      },
      {
        providerId: "anthropic",
        modelId: "claude-3-5-haiku",
        included: true,
        exclusionReason: null,
        scoreBreakdown: {
          costScore: 0.83,
          latencyScore: 0.267,
          qualityScore: 0.6,
          reliabilityScore: 0.995,
          capabilityScore: 1.0,
          total: 0.7623,
        },
      },
      {
        providerId: "google",
        modelId: "gemini-1.5-flash",
        included: false,
        exclusionReason: "published p95 latency 1200ms exceeds ceiling 1000ms",
        scoreBreakdown: {
          costScore: 0,
          latencyScore: 0,
          qualityScore: 0,
          reliabilityScore: 0,
          capabilityScore: 0,
          total: 0,
        },
      },
    ],
    chosenModelId: "gpt-4o-mini",
    chosenProviderId: "openai",
    rationale: [
      {
        factor: "cost",
        verdict: "preferred",
        note: "lowest normalised cost among included candidates (weight 0.70)",
      },
      {
        factor: "latency",
        verdict: "neutral",
        note: "published p95 400ms comfortably under 1000ms ceiling",
      },
    ],
    pricingTableVersionId: "pricing-v2024-10-01",
    estimatedCostUsd: "0.000420",
  },
};
