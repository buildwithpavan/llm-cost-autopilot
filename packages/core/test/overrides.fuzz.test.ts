import { describe, expect, it } from "vitest";

import { resolveOverride } from "../src/overrides/resolve.js";
import { matchesRule } from "../src/overrides/match.js";
import type {
  Capability,
  ClientOverride,
  NormalizedRequest,
  OperatorRule,
} from "../src/index.js";

// Deterministic PRNG (mulberry32) so the fuzz run is fully reproducible in CI.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CAPS: Capability[] = ["tool_use", "json_mode", "function_calling", "vision"];
const CLIENTS = ["client-a", "client-b", "client-c", "", "\u0000edge", "𝔘nicode"];
const PROVIDERS = ["mock-cheap", "mock-fast", "", "../etc", "'; DROP TABLE--"];
// Boundary priorities: extremes, zero, negatives, and collisions.
const PRIORITIES = [
  Number.MIN_SAFE_INTEGER,
  -1,
  0,
  1,
  10,
  10,
  Number.MAX_SAFE_INTEGER,
];

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function mkRequest(rng: () => number): NormalizedRequest {
  const caps = CAPS.filter(() => rng() < 0.4);
  const hasOverride = rng() < 0.5;
  const override: ClientOverride | null = hasOverride
    ? { providerId: pick(rng, PROVIDERS) || "mock-cheap", modelId: rng() < 0.5 ? "m:x" : null }
    : null;
  return {
    requestId: "01924b1a-4c9f-7000-b000-000000000001",
    clientId: pick(rng, CLIENTS),
    receivedAt: "2026-09-08T00:00:00.000Z",
    messages: [{ role: "user", content: "hi" }],
    requirements: { requiredCapabilities: caps },
    override,
    // Boundary token counts including 0 and a very large value.
    estimatedInputTokens: pick(rng, [0, 1, 99, 100, 101, 1_000_000, Number.MAX_SAFE_INTEGER]),
  };
}

function mkRule(rng: () => number, i: number): OperatorRule {
  const clientIds =
    rng() < 0.33 ? null : Array.from({ length: Math.floor(rng() * 4) }, () => pick(rng, CLIENTS));
  const requiredCapabilities =
    rng() < 0.33 ? null : CAPS.filter(() => rng() < 0.5);
  const lo = rng() < 0.5 ? null : pick(rng, [0, 100, 1_000_000]);
  const hi = rng() < 0.5 ? null : pick(rng, [0, 100, 1_000_000]);
  return {
    // Deliberately non-unique ruleId prefix to exercise the lexicographic tiebreak.
    ruleId: `rule-${pick(rng, ["a", "b", "c"])}-${i}`,
    priority: pick(rng, PRIORITIES),
    enabled: rng() < 0.85,
    match: {
      clientIds,
      requiredCapabilities,
      minEstimatedTokens: lo,
      maxEstimatedTokens: hi,
    },
    pin: { providerId: pick(rng, PROVIDERS) || "mock-cheap", modelId: rng() < 0.5 ? "m:y" : null },
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
  };
}

/** Independent reference for the winning rule (FR-027 precedence + deterministic tiebreak). */
function expectedWinner(rules: OperatorRule[], req: NormalizedRequest): OperatorRule | null {
  const matching = rules
    .filter((r) => matchesRule(r, req))
    .sort((a, b) => (a.priority !== b.priority ? a.priority - b.priority : a.ruleId.localeCompare(b.ruleId)));
  return matching[0] ?? null;
}

describe("override precedence fuzz (FR-027 governance boundary)", () => {
  it("upholds operator>client>autopilot across 2000 adversarial rule/request combos", () => {
    const rng = mulberry32(0x5eed_1234);
    for (let i = 0; i < 2000; i++) {
      const req = mkRequest(rng);
      const rules = Array.from({ length: Math.floor(rng() * 6) }, (_, j) => mkRule(rng, j));

      let res: ReturnType<typeof resolveOverride>;
      // Never throws on any adversarial/boundary input.
      expect(() => {
        res = resolveOverride({ request: req, rules });
      }).not.toThrow();
      res = resolveOverride({ request: req, rules });

      // Determinism: identical inputs → identical output.
      expect(resolveOverride({ request: req, rules })).toEqual(res);

      const winner = expectedWinner(rules, req);
      if (winner) {
        // Security invariant: a matching operator rule ALWAYS wins; a client
        // override can never bypass it and is recorded as shadowed.
        expect(res.effectiveSource).toBe("operator_rule");
        expect(res.matchedRuleId).toBe(winner.ruleId);
        expect(res.pin).toBe(winner.pin);
        expect(res.shadowedSource).toBe(req.override ? "client_override" : null);
      } else if (req.override) {
        expect(res.effectiveSource).toBe("client_override");
        expect(res.pin).toBe(req.override);
        expect(res.shadowedSource).toBeNull();
      } else {
        expect(res.effectiveSource).toBe("autopilot");
        expect(res.pin).toBeNull();
        expect(res.shadowedSource).toBeNull();
      }
    }
  });

  it("does not degrade on a pathological all-matching rule set (DoS sanity)", () => {
    const req: NormalizedRequest = {
      requestId: "01924b1a-4c9f-7000-b000-000000000002",
      clientId: "client-a",
      receivedAt: "2026-09-08T00:00:00.000Z",
      messages: [{ role: "user", content: "hi" }],
      requirements: { requiredCapabilities: [] },
      override: { providerId: "client-pinned", modelId: null },
      estimatedInputTokens: 100,
    };
    // 5000 enabled, all-matching rules with colliding priorities.
    const rules: OperatorRule[] = Array.from({ length: 5000 }, (_, i) => ({
      ruleId: `rule-${String(i).padStart(5, "0")}`,
      priority: 0,
      enabled: true,
      match: { clientIds: null, requiredCapabilities: null, minEstimatedTokens: null, maxEstimatedTokens: null },
      pin: { providerId: `p-${i}`, modelId: null },
      createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T00:00:00.000Z",
    }));
    const res = resolveOverride({ request: req, rules });
    // Lowest ruleId under equal priority wins deterministically; client override shadowed.
    expect(res.effectiveSource).toBe("operator_rule");
    expect(res.matchedRuleId).toBe("rule-00000");
    expect(res.shadowedSource).toBe("client_override");
  });
});
