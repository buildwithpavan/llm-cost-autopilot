import type { TelemetryEvent } from "../types/telemetry.js";
import { MAX_LENGTH, RULES, TRUNCATION_SUFFIX } from "./rules.js";

const BRAND = Symbol("lca.redacted");

export type RedactedTelemetryEvent = TelemetryEvent & { readonly [BRAND]: true };

/** Apply redaction rules + truncation to a single string. Returns a new string. */
export function applyRedaction(input: string): string {
  let out = input;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, `[REDACTED:${rule.kind}]`);
  }
  if (out.length > MAX_LENGTH) {
    out = out.slice(0, MAX_LENGTH) + TRUNCATION_SUFFIX;
  }
  return out;
}

function redactStringsDeep<T>(value: T): T {
  if (typeof value === "string") return applyRedaction(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactStringsDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactStringsDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}

/** Applies redaction to an event and returns a brand-typed copy. Does not mutate input. */
export function applyRedactionToTelemetry(event: TelemetryEvent): RedactedTelemetryEvent {
  const cloned = structuredClone(event);
  // Redact string leaves inside the routingRationale (rationale notes may echo user text).
  cloned.routingRationale = redactStringsDeep(cloned.routingRationale);
  // Attempts are numeric/enum + IDs; still deep-redact to be safe if we later add raw payloads.
  cloned.attempts = redactStringsDeep(cloned.attempts);
  Object.defineProperty(cloned, BRAND, { value: true, enumerable: false });
  return cloned as RedactedTelemetryEvent;
}

export function assertRedacted(event: RedactedTelemetryEvent): void {
  if (!(event as unknown as Record<PropertyKey, unknown>)[BRAND]) {
    throw new Error("telemetry event not passed through redaction gate");
  }
}
