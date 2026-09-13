import { describe, expect, it } from "vitest";
import type { TelemetryStreamEvent } from "@lca/core";
import { initialGraphState, reduce } from "../src/features/live-graph/graph-reducer";

const CLIENT = "acme-corp";
const EVENT_ID = "aa000000-0000-0000-0000-000000000001";

function seq(events: Array<Omit<TelemetryStreamEvent, "seq">>): TelemetryStreamEvent[] {
  return events.map((e, i) => ({ ...e, seq: i + 1 } as TelemetryStreamEvent));
}

describe("graph-reducer", () => {
  it("starts with the flow idle and every stage idle", () => {
    const state = initialGraphState();
    expect(state.flow).toBe("idle");
    Object.values(state.stages).forEach((s) => expect(s).toBe("idle"));
    Object.values(state.edges).forEach((s) => expect(s).toBe("idle"));
  });

  it("activates the request stage on request.received", () => {
    const events = seq([
      {
        eventType: "request.received",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.000Z",
        estimatedInputTokens: 1200,
        requiredCapabilities: [],
      },
    ]);
    const state = events.reduce(reduce, initialGraphState());
    expect(state.flow).toBe("receiving");
    expect(state.stages.request).toBe("active");
    expect(state.edges.requestToGovernance).toBe("active");
    expect(state.edges.clientToEngine).toBe("active");
    expect(state.timeline).toHaveLength(1);
    expect(state.timeline[0]?.title).toBe("Request received");
  });

  it("moves through the full happy path to success", () => {
    const start = "2026-09-09T10:00:00.000Z";
    const events = seq([
      {
        eventType: "request.received",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: start,
        estimatedInputTokens: 1200,
        requiredCapabilities: [],
      },
      {
        eventType: "governance.completed",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.012Z",
        decisionSource: "autopilot",
        shadowedSource: null,
        matchedRuleId: null,
      },
      {
        eventType: "decision.committed",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.040Z",
        decision: {
          decisionSource: "autopilot",
          shadowedSource: null,
          candidateRanking: [
            {
              providerId: "openai",
              modelId: "gpt-4o-mini",
              included: true,
              exclusionReason: null,
              scoreBreakdown: { total: 0.9131 },
            },
          ],
          chosenProviderId: "openai",
          chosenModelId: "gpt-4o-mini",
          rationale: [],
          pricingTableVersionId: "pt-v",
          estimatedCostUsd: "0.000420",
        },
      },
      {
        eventType: "execution.started",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.042Z",
        attemptIndex: 0,
        providerId: "openai",
        modelId: "gpt-4o-mini",
      },
      {
        eventType: "execution.completed",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.088Z",
        attempt: {
          attemptIndex: 0,
          providerId: "openai",
          modelId: "gpt-4o-mini",
          startedAt: "2026-09-09T10:00:00.042Z",
          endedAt: "2026-09-09T10:00:00.088Z",
          latencyMs: 46,
          inputTokens: 1200,
          outputTokens: 320,
          errorClass: "none",
          estimatedCostUsd: "0.000420",
          actualCostUsd: "0.000410",
          pricingTableVersionId: "pt-v",
        },
      },
      {
        eventType: "result.completed",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.089Z",
        totalLatencyMs: 46,
        terminalErrorClass: "none",
      },
    ]);
    const state = events.reduce(reduce, initialGraphState());
    expect(state.flow).toBe("success");
    expect(state.stages.result).toBe("completed");
    expect(state.edges.executeToResult).toBe("completed");
    expect(state.winnerProviderId).toBe("openai");
    expect(state.winnerModelId).toBe("gpt-4o-mini");
    expect(state.attempts).toHaveLength(1);
    expect(state.hasFallback).toBe(false);
    expect(state.timeline.at(-1)?.title).toBe("Completed");
  });

  it("marks a candidate excluded with the backend exclusion reason", () => {
    const state = seq([
      {
        eventType: "request.received",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.000Z",
        estimatedInputTokens: 1200,
        requiredCapabilities: [],
      },
      {
        eventType: "candidate.excluded",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.036Z",
        candidate: {
          providerId: "google",
          modelId: "gemini-1.5-flash",
          included: false,
          exclusionReason: "published p95 latency 1200ms exceeds ceiling 1000ms",
          scoreBreakdown: {},
        },
      },
    ]).reduce(reduce, initialGraphState());
    const excluded = state.candidates.find((c) => c.kind === "excluded");
    expect(excluded?.providerId).toBe("google");
    expect(excluded?.exclusionReason).toContain("exceeds ceiling");
  });

  it("detects a fallback attempt", () => {
    const state = seq([
      {
        eventType: "request.received",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.000Z",
        estimatedInputTokens: 1200,
        requiredCapabilities: [],
      },
      {
        eventType: "execution.started",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.042Z",
        attemptIndex: 1,
        providerId: "anthropic",
        modelId: "claude-3-5-haiku",
      },
    ]).reduce(reduce, initialGraphState());
    expect(state.hasFallback).toBe(true);
    expect(state.timeline.at(-1)?.title).toBe("Fallback executing");
  });

  it("marks failure and paints the result edge red", () => {
    const state = seq([
      {
        eventType: "request.received",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.000Z",
        estimatedInputTokens: 1200,
        requiredCapabilities: [],
      },
      {
        eventType: "result.failed",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.100Z",
        totalLatencyMs: 100,
        terminalErrorClass: "terminal_fallback_exhausted",
      },
    ]).reduce(reduce, initialGraphState());
    expect(state.flow).toBe("failed");
    expect(state.stages.result).toBe("failed");
    expect(state.edges.executeToResult).toBe("failed");
    expect(state.terminalErrorClass).toBe("terminal_fallback_exhausted");
  });

  it("recognises operator_rule with shadowed client_override", () => {
    const state = seq([
      {
        eventType: "request.received",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.000Z",
        estimatedInputTokens: 1200,
        requiredCapabilities: [],
      },
      {
        eventType: "governance.completed",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.012Z",
        decisionSource: "operator_rule",
        shadowedSource: "client_override",
        matchedRuleId: "rule-a3f8b2",
      },
    ]).reduce(reduce, initialGraphState());
    expect(state.edges.engineToPolicies).toBe("active");
    expect(state.nodes.policies).toBe("active");
    expect(state.nodes.catalog).toBe("bypassed");
    expect(state.decisionSource).toBe("operator_rule");
    expect(state.shadowedSource).toBe("client_override");
    expect(state.matchedRuleId).toBe("rule-a3f8b2");
    const lastTrace = state.timeline.at(-1);
    expect(lastTrace?.detail).toContain("operator_rule");
    expect(lastTrace?.detail).toContain("shadowed");
  });

  it("drives a real fallback flow: attempt 0 fails then attempt 1 succeeds", () => {
    const events = seq([
      {
        eventType: "request.received",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.000Z",
        estimatedInputTokens: 1200,
        requiredCapabilities: [],
      },
      {
        eventType: "governance.completed",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.005Z",
        decisionSource: "autopilot",
        shadowedSource: null,
        matchedRuleId: null,
      },
      {
        eventType: "execution.started",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.010Z",
        attemptIndex: 0,
        providerId: "mock-cheap",
        modelId: "mock-cheap:small",
      },
      {
        eventType: "execution.completed",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.015Z",
        attempt: {
          attemptIndex: 0,
          providerId: "mock-cheap",
          modelId: "mock-cheap:small",
          startedAt: "2026-09-09T10:00:00.010Z",
          endedAt: "2026-09-09T10:00:00.015Z",
          latencyMs: 5,
          inputTokens: null,
          outputTokens: null,
          errorClass: "upstream_5xx",
          estimatedCostUsd: "0",
          actualCostUsd: null,
          pricingTableVersionId: "pt-v",
        },
      },
      {
        eventType: "execution.started",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.016Z",
        attemptIndex: 1,
        providerId: "mock-cheap",
        modelId: "mock-cheap:large",
      },
      {
        eventType: "execution.completed",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.020Z",
        attempt: {
          attemptIndex: 1,
          providerId: "mock-cheap",
          modelId: "mock-cheap:large",
          startedAt: "2026-09-09T10:00:00.016Z",
          endedAt: "2026-09-09T10:00:00.020Z",
          latencyMs: 4,
          inputTokens: 17,
          outputTokens: 4,
          errorClass: "none",
          estimatedCostUsd: "0.000013",
          actualCostUsd: "0.000013",
          pricingTableVersionId: "pt-v",
        },
      },
      {
        eventType: "result.completed",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.021Z",
        totalLatencyMs: 21,
        terminalErrorClass: "none",
      },
    ]);
    const state = events.reduce(reduce, initialGraphState());
    expect(state.attempts).toHaveLength(2);
    expect(state.attempts[0]?.errorClass).toBe("upstream_5xx");
    expect(state.attempts[1]?.errorClass).toBe("none");
    expect(state.hasFallback).toBe(true);
    expect(state.edges.candidatesToExecution).toBe("completed");
    expect(state.edges.executionToResult).toBe("completed");
    expect(state.nodes.execution).toBe("completed");
    expect(state.nodes.result).toBe("completed");
    expect(state.flow).toBe("success");
    // trace must retain both attempts: "Attempt failed" then "Fallback executing" then "Response received"
    const titles = state.timeline.map((t) => t.title);
    expect(titles).toContain("Attempt failed");
    expect(titles).toContain("Fallback executing");
    expect(titles).toContain("Response received");
    expect(titles).toContain("Completed");
  });

  it("ignores events with a stale sequence number", () => {
    const first = seq([
      {
        eventType: "request.received",
        eventId: EVENT_ID,
        clientId: CLIENT,
        timestamp: "2026-09-09T10:00:00.000Z",
        estimatedInputTokens: 1200,
        requiredCapabilities: [],
      },
    ])[0]!;
    let state = reduce(initialGraphState(), first);
    // Replay a lower seq: the reducer must drop it.
    const stale = { ...first, seq: 0 };
    state = reduce(state, stale);
    expect(state.timeline).toHaveLength(1);
    expect(state.lastSeq).toBe(1);
  });

  it("ignores heartbeats", () => {
    const state = reduce(initialGraphState(), {
      seq: 1,
      eventType: "stream.heartbeat",
      eventId: "",
      clientId: CLIENT,
      timestamp: "2026-09-09T10:00:00.000Z",
    } as TelemetryStreamEvent);
    expect(state).toEqual(initialGraphState());
  });
});
