import { describe, expect, it, vi } from "vitest";

import {
  circuitConfigFrom,
  createCircuitBreaker,
  isCircuitTrippingErrorClass,
  type CircuitBreakerConfig,
  type CircuitState,
} from "../../src/routing/circuit-breaker.js";

function makeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

const CFG: CircuitBreakerConfig = { enabled: true, failureThreshold: 3, cooldownMs: 1_000 };
const P = "mock-cheap";

describe("isCircuitTrippingErrorClass", () => {
  it("trips on availability failures only", () => {
    for (const c of ["timeout", "rate_limit", "upstream_5xx", "provider_unavailable"] as const) {
      expect(isCircuitTrippingErrorClass(c)).toBe(true);
    }
    for (const c of ["upstream_4xx", "invalid_request", "context_exceeded", "override_target_missing", "none"] as const) {
      expect(isCircuitTrippingErrorClass(c)).toBe(false);
    }
  });
});

describe("circuit breaker state machine", () => {
  it("CLOSED allows execution and counts failures up to the threshold, then OPENs", () => {
    const clock = makeClock();
    const transitions: Array<[CircuitState, CircuitState]> = [];
    const cb = createCircuitBreaker(CFG, { now: clock.now, onTransition: (_p, f, t) => transitions.push([f, t]) });

    expect(cb.tryAcquire(P)).toEqual({ allowed: true, probe: false });
    cb.recordOutcome(P, "upstream_5xx");
    expect(cb.getState(P)).toBe("closed");
    cb.recordOutcome(P, "timeout");
    expect(cb.getState(P)).toBe("closed");
    cb.recordOutcome(P, "rate_limit"); // 3rd consecutive availability failure
    expect(cb.getState(P)).toBe("open");
    expect(transitions).toEqual([["closed", "open"]]);
  });

  it("OPEN blocks execution before cooldown and transitions to HALF_OPEN after", () => {
    const clock = makeClock();
    const cb = createCircuitBreaker(CFG, { now: clock.now });
    for (let i = 0; i < 3; i++) cb.recordOutcome(P, "upstream_5xx");
    expect(cb.getState(P)).toBe("open");

    clock.advance(999);
    expect(cb.tryAcquire(P)).toEqual({ allowed: false, probe: false });
    expect(cb.getState(P)).toBe("open");

    clock.advance(1); // cooldown reached
    expect(cb.tryAcquire(P)).toEqual({ allowed: true, probe: true });
    expect(cb.getState(P)).toBe("half_open");
  });

  it("a successful HALF_OPEN probe CLOSEs the circuit and resets failures", () => {
    const clock = makeClock();
    const cb = createCircuitBreaker(CFG, { now: clock.now });
    for (let i = 0; i < 3; i++) cb.recordOutcome(P, "upstream_5xx");
    clock.advance(1_000);
    cb.tryAcquire(P); // probe
    cb.recordOutcome(P, "none");
    expect(cb.getState(P)).toBe("closed");
    // Failures were reset: two more do not immediately reopen.
    cb.recordOutcome(P, "timeout");
    cb.recordOutcome(P, "timeout");
    expect(cb.getState(P)).toBe("closed");
  });

  it("a failed HALF_OPEN probe reOPENs and restarts the cooldown", () => {
    const clock = makeClock();
    const cb = createCircuitBreaker(CFG, { now: clock.now });
    for (let i = 0; i < 3; i++) cb.recordOutcome(P, "upstream_5xx");
    clock.advance(1_000);
    cb.tryAcquire(P); // probe
    cb.recordOutcome(P, "timeout"); // probe fails
    expect(cb.getState(P)).toBe("open");
    // Cooldown restarted from the reopen moment.
    expect(cb.tryAcquire(P)).toEqual({ allowed: false, probe: false });
    clock.advance(1_000);
    expect(cb.tryAcquire(P)).toEqual({ allowed: true, probe: true });
  });

  it("a non-availability probe result also recovers (provider was reachable)", () => {
    const clock = makeClock();
    const cb = createCircuitBreaker(CFG, { now: clock.now });
    for (let i = 0; i < 3; i++) cb.recordOutcome(P, "upstream_5xx");
    clock.advance(1_000);
    cb.tryAcquire(P);
    cb.recordOutcome(P, "invalid_request"); // reachable, non-availability
    expect(cb.getState(P)).toBe("closed");
  });

  it("a successful CLOSED execution resets the consecutive failure count", () => {
    const cb = createCircuitBreaker(CFG);
    cb.recordOutcome(P, "timeout");
    cb.recordOutcome(P, "timeout");
    cb.recordOutcome(P, "none"); // reset
    cb.recordOutcome(P, "timeout");
    cb.recordOutcome(P, "timeout");
    expect(cb.getState(P)).toBe("closed"); // only 2 since reset
    cb.recordOutcome(P, "timeout");
    expect(cb.getState(P)).toBe("open");
  });
});

describe("failure classification contributes correctly", () => {
  it("non-availability failures never open the circuit", () => {
    const cb = createCircuitBreaker({ enabled: true, failureThreshold: 2, cooldownMs: 1_000 });
    for (const c of ["upstream_4xx", "invalid_request", "context_exceeded"] as const) {
      for (let i = 0; i < 10; i++) cb.recordOutcome("p", c);
    }
    expect(cb.getState("p")).toBe("closed");
  });

  it("availability failures open at the threshold", () => {
    const cb = createCircuitBreaker({ enabled: true, failureThreshold: 2, cooldownMs: 1_000 });
    cb.recordOutcome("p", "timeout");
    cb.recordOutcome("p", "upstream_5xx");
    expect(cb.getState("p")).toBe("open");
  });
});

describe("half-open concurrency", () => {
  it("grants the probe slot to exactly one concurrent caller", () => {
    const clock = makeClock();
    const cb = createCircuitBreaker(CFG, { now: clock.now });
    for (let i = 0; i < 3; i++) cb.recordOutcome(P, "upstream_5xx");
    clock.advance(1_000);
    // Ten simultaneous acquire attempts after cooldown.
    const results = Array.from({ length: 10 }, () => cb.tryAcquire(P));
    const probes = results.filter((r) => r.allowed && r.probe);
    const denied = results.filter((r) => !r.allowed);
    expect(probes).toHaveLength(1);
    expect(denied).toHaveLength(9);
  });
});

describe("retry accounting (logical attempts)", () => {
  it("counts one logical outcome per recordOutcome call regardless of retry depth", () => {
    // The caller invokes recordOutcome ONCE per provider candidate (after Phase 8
    // retries collapse into a single outcome), so threshold counts logical attempts.
    const cb = createCircuitBreaker({ enabled: true, failureThreshold: 3, cooldownMs: 1_000 });
    cb.recordOutcome(P, "timeout"); // request 1 (its internal retries are not counted here)
    cb.recordOutcome(P, "timeout"); // request 2
    expect(cb.getState(P)).toBe("closed");
    cb.recordOutcome(P, "timeout"); // request 3 → open
    expect(cb.getState(P)).toBe("open");
  });
});

describe("openProviderCount", () => {
  it("reflects the number of OPEN providers", () => {
    const cb = createCircuitBreaker({ enabled: true, failureThreshold: 1, cooldownMs: 1_000 });
    expect(cb.openProviderCount()).toBe(0);
    cb.recordOutcome("a", "timeout");
    cb.recordOutcome("b", "upstream_5xx");
    expect(cb.openProviderCount()).toBe(2);
  });
});

describe("disabled breaker", () => {
  it("always allows and never changes state", () => {
    const cb = createCircuitBreaker({ enabled: false, failureThreshold: 1, cooldownMs: 1 });
    for (let i = 0; i < 5; i++) cb.recordOutcome(P, "timeout");
    expect(cb.getState(P)).toBe("closed");
    expect(cb.tryAcquire(P)).toEqual({ allowed: true, probe: false });
    expect(cb.openProviderCount()).toBe(0);
  });
});

describe("circuitConfigFrom", () => {
  it("maps env-derived config", () => {
    expect(
      circuitConfigFrom({ LCA_CIRCUIT_ENABLED: true, LCA_CIRCUIT_FAILURE_THRESHOLD: 7, LCA_CIRCUIT_COOLDOWN_MS: 1234 }),
    ).toEqual({ enabled: true, failureThreshold: 7, cooldownMs: 1234 });
  });
});

describe("transition hook", () => {
  it("fires on each transition with provider id and direction", () => {
    const clock = makeClock();
    const onTransition = vi.fn();
    const cb = createCircuitBreaker(CFG, { now: clock.now, onTransition });
    for (let i = 0; i < 3; i++) cb.recordOutcome(P, "upstream_5xx"); // closed→open
    clock.advance(1_000);
    cb.tryAcquire(P); // open→half_open
    cb.recordOutcome(P, "none"); // half_open→closed
    expect(onTransition.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["closed", "open"],
      ["open", "half_open"],
      ["half_open", "closed"],
    ]);
    expect(onTransition.mock.calls.every((c) => c[0] === P)).toBe(true);
  });
});
