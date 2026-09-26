import { describe, expect, it } from "vitest";
import type { RoutingDecision } from "../src/types";
import type { ReplayResult } from "../src/lib/api/replay";
import { deriveReplayComparison, formatRoute, routeIdentity } from "../src/features/replay/replay-model";

function decision(over: Partial<RoutingDecision>): RoutingDecision {
  return {
    decisionSource: "autopilot",
    shadowedSource: null,
    candidateRanking: [],
    chosenModelId: "mock-cheap:small",
    chosenProviderId: "mock-cheap",
    rationale: [],
    pricingTableVersionId: "seed-2026-09-08",
    estimatedCostUsd: "0.000010",
    ...over,
  };
}

describe("deriveReplayComparison", () => {
  it("reports a match for a scored autopilot decision that agrees", () => {
    const result: ReplayResult = {
      recorded: decision({ decisionSource: "autopilot" }),
      replayed: decision({ decisionSource: "autopilot" }),
      matches: true,
    };
    const c = deriveReplayComparison(result);
    expect(c.kind).toBe("scored");
    expect(c.matches).toBe(true);
    expect(c.drift).toBe(false);
    expect(c.replayError).toBeNull();
  });

  it("reports drift when the scored replay selected a different route", () => {
    const result: ReplayResult = {
      recorded: decision({ chosenProviderId: "mock-cheap", chosenModelId: "mock-cheap:small" }),
      replayed: decision({ chosenProviderId: "mock-fast", chosenModelId: "mock-fast:default" }),
      matches: false,
    };
    const c = deriveReplayComparison(result);
    expect(c.kind).toBe("scored");
    expect(c.drift).toBe(true);
    expect(formatRoute(c.recorded)).toBe("mock-cheap:mock-cheap:small");
    expect(formatRoute(c.replayed)).toBe("mock-fast:mock-fast:default");
  });

  it("marks operator_rule decisions as deterministic passthrough", () => {
    const rec = decision({ decisionSource: "operator_rule" });
    const c = deriveReplayComparison({ recorded: rec, replayed: rec, matches: true });
    expect(c.kind).toBe("passthrough");
    expect(c.drift).toBe(false);
    expect(c.matches).toBe(true);
  });

  it("marks client_override decisions as deterministic passthrough", () => {
    const rec = decision({ decisionSource: "client_override" });
    const c = deriveReplayComparison({ recorded: rec, replayed: rec, matches: true });
    expect(c.kind).toBe("passthrough");
    expect(c.drift).toBe(false);
  });

  it("treats a null replayed decision with replayError as an error (not drift)", () => {
    const result: ReplayResult = {
      recorded: decision({ decisionSource: "autopilot" }),
      replayed: null,
      matches: false,
      replayError: "no eligible candidates",
    };
    const c = deriveReplayComparison(result);
    expect(c.kind).toBe("error");
    expect(c.drift).toBe(false);
    expect(c.replayed).toBeNull();
    expect(c.replayError).toBe("no eligible candidates");
  });

  it("tolerates a missing replayError field on a null replay", () => {
    const c = deriveReplayComparison({ recorded: decision({}), replayed: null, matches: false });
    expect(c.kind).toBe("error");
    expect(c.replayError).toBeNull();
  });

  it("keeps the recorded decision available in every kind", () => {
    const rec = decision({ chosenProviderId: "openai", chosenModelId: "gpt-4o" });
    for (const result of [
      { recorded: rec, replayed: rec, matches: true } as ReplayResult,
      { recorded: rec, replayed: null, matches: false, replayError: "x" } as ReplayResult,
    ]) {
      expect(deriveReplayComparison(result).recorded).toBe(rec);
    }
  });
});

describe("routeIdentity / formatRoute", () => {
  it("formats a decision as provider:model", () => {
    expect(formatRoute(decision({ chosenProviderId: "openai", chosenModelId: "gpt-4o" }))).toBe("openai:gpt-4o");
    expect(routeIdentity(decision({ chosenProviderId: "openai", chosenModelId: "gpt-4o" }))).toEqual({
      providerId: "openai",
      modelId: "gpt-4o",
    });
  });

  it("returns a neutral placeholder (never fabricated) when the decision is absent", () => {
    expect(formatRoute(null)).toBe("—");
    expect(formatRoute(undefined)).toBe("—");
    expect(routeIdentity(null)).toBeNull();
  });

  it("does not fabricate an identity from partial data", () => {
    expect(routeIdentity({ chosenProviderId: "openai" } as unknown as RoutingDecision)).toBeNull();
    expect(formatRoute({ chosenModelId: "gpt-4o" } as unknown as RoutingDecision)).toBe("—");
  });
});
