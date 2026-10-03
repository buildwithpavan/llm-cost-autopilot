import type { ErrorClass } from "@lca/core";

/**
 * Error classes that count as provider *availability* failures and therefore
 * contribute to the circuit breaker. Mirrors the Phase 8 transient set plus
 * `provider_unavailable`; deterministic client/validation/routing errors
 * (`upstream_4xx`, `invalid_request`, `context_exceeded`, `override_target_missing`)
 * never trip the circuit, and budget/governance failures never reach provider
 * execution so they can never affect circuit state.
 */
const TRIPPING: ReadonlySet<ErrorClass> = new Set([
  "timeout",
  "rate_limit",
  "upstream_5xx",
  "provider_unavailable",
]);

export function isCircuitTrippingErrorClass(errorClass: ErrorClass): boolean {
  return TRIPPING.has(errorClass);
}

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  readonly enabled: boolean;
  /** Consecutive availability failures (while CLOSED) that open the circuit. */
  readonly failureThreshold: number;
  /** Time a circuit stays OPEN before allowing a single HALF_OPEN probe. */
  readonly cooldownMs: number;
}

export interface CircuitBreakerHooks {
  /** Injectable monotonic-ish clock (ms epoch). Defaults to Date.now. */
  readonly now?: () => number;
  /** Called on every state transition (for structured logging + metrics). */
  readonly onTransition?: (providerId: string, from: CircuitState, to: CircuitState) => void;
}

/** Result of an acquire attempt at the execution boundary. */
export interface AcquireResult {
  /** Whether the provider may be executed now. */
  readonly allowed: boolean;
  /** True when this caller holds the single HALF_OPEN probe slot. */
  readonly probe: boolean;
}

export interface CircuitBreaker {
  /**
   * Atomically decide whether a provider may execute. Race-safe: the whole
   * method is synchronous (no await), so the HALF_OPEN probe slot is granted to
   * exactly one caller even under concurrent requests.
   */
  tryAcquire(providerId: string): AcquireResult;
  /** Record a logical provider-attempt outcome (`"none"` = success). */
  recordOutcome(providerId: string, errorClass: ErrorClass): void;
  getState(providerId: string): CircuitState;
  openProviderCount(): number;
}

interface Entry {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number;
  probeInFlight: boolean;
}

export function createCircuitBreaker(
  config: CircuitBreakerConfig,
  hooks: CircuitBreakerHooks = {},
): CircuitBreaker {
  const now = hooks.now ?? Date.now;
  const entries = new Map<string, Entry>();

  function entry(providerId: string): Entry {
    let e = entries.get(providerId);
    if (!e) {
      e = { state: "closed", consecutiveFailures: 0, openedAt: 0, probeInFlight: false };
      entries.set(providerId, e);
    }
    return e;
  }

  function transition(providerId: string, e: Entry, to: CircuitState): void {
    const from = e.state;
    if (from === to) return;
    e.state = to;
    hooks.onTransition?.(providerId, from, to);
  }

  return {
    tryAcquire(providerId: string): AcquireResult {
      if (!config.enabled) return { allowed: true, probe: false };
      const e = entry(providerId);
      switch (e.state) {
        case "closed":
          return { allowed: true, probe: false };
        case "open":
          if (now() - e.openedAt >= config.cooldownMs) {
            transition(providerId, e, "half_open");
            e.probeInFlight = true;
            return { allowed: true, probe: true };
          }
          return { allowed: false, probe: false };
        case "half_open":
          // A probe is already outstanding; everyone else follows fallback.
          if (e.probeInFlight) return { allowed: false, probe: false };
          e.probeInFlight = true;
          return { allowed: true, probe: true };
      }
    },

    recordOutcome(providerId: string, errorClass: ErrorClass): void {
      if (!config.enabled) return;
      const e = entry(providerId);
      const tripping = errorClass !== "none" && isCircuitTrippingErrorClass(errorClass);

      if (e.state === "half_open") {
        e.probeInFlight = false;
        if (tripping) {
          // Probe failed with an availability error: reopen and restart cooldown.
          e.openedAt = now();
          transition(providerId, e, "open");
        } else {
          // Probe reached the provider (success or a non-availability error): recover.
          e.consecutiveFailures = 0;
          transition(providerId, e, "closed");
        }
        return;
      }

      if (e.state === "closed") {
        if (tripping) {
          e.consecutiveFailures += 1;
          if (e.consecutiveFailures >= config.failureThreshold) {
            e.openedAt = now();
            transition(providerId, e, "open");
          }
        } else {
          // Any non-availability outcome breaks the consecutive-failure streak.
          e.consecutiveFailures = 0;
        }
      }
      // OPEN: no execution should have occurred, so nothing to record.
    },

    getState(providerId: string): CircuitState {
      return entries.get(providerId)?.state ?? "closed";
    },

    openProviderCount(): number {
      let n = 0;
      for (const e of entries.values()) if (e.state === "open") n += 1;
      return n;
    },
  };
}

export function circuitConfigFrom(config: {
  LCA_CIRCUIT_ENABLED: boolean;
  LCA_CIRCUIT_FAILURE_THRESHOLD: number;
  LCA_CIRCUIT_COOLDOWN_MS: number;
}): CircuitBreakerConfig {
  return {
    enabled: config.LCA_CIRCUIT_ENABLED,
    failureThreshold: config.LCA_CIRCUIT_FAILURE_THRESHOLD,
    cooldownMs: config.LCA_CIRCUIT_COOLDOWN_MS,
  };
}
