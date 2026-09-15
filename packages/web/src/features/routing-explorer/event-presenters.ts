import type { TelemetryEvent } from "../../types/index.js";

export type DecisionSource = TelemetryEvent["decisionSource"];

export interface Semantic {
  label: string;
  color: string;
  bg: string;
  border: string;
}

/** Decision-source badge styling, driven by the real `decisionSource` enum. */
export function decisionSourceMeta(src: DecisionSource): Semantic {
  switch (src) {
    case "operator_rule":
      return {
        label: "operator rule",
        color: "var(--warn)",
        bg: "rgba(242, 171, 71, 0.12)",
        border: "rgba(242, 171, 71, 0.42)",
      };
    case "client_override":
      return {
        label: "client override",
        color: "var(--accent-purple)",
        bg: "rgba(107, 71, 255, 0.14)",
        border: "rgba(107, 71, 255, 0.45)",
      };
    case "autopilot":
    default:
      return {
        label: "autopilot",
        color: "var(--accent-primary)",
        bg: "rgba(99, 110, 255, 0.12)",
        border: "rgba(99, 110, 255, 0.42)",
      };
  }
}

/** Terminal outcome derived strictly from `terminalErrorClass`. */
export function statusMeta(event: TelemetryEvent): Semantic & { ok: boolean } {
  const ok = event.terminalErrorClass === "none";
  if (ok) {
    return {
      ok,
      label: "success",
      color: "var(--success)",
      bg: "rgba(38, 214, 138, 0.12)",
      border: "rgba(38, 214, 138, 0.42)",
    };
  }
  return {
    ok,
    label: event.terminalErrorClass.replace(/_/g, " "),
    color: "var(--error)",
    bg: "rgba(242, 89, 89, 0.12)",
    border: "rgba(242, 89, 89, 0.42)",
  };
}

export type ReconciliationState = "reconciled" | "mismatch" | "pending";

/** Reconciliation state from the nullable `reconciled` flag. */
export function reconciliationState(event: TelemetryEvent): ReconciliationState {
  if (event.reconciled === null || event.reconciled === undefined) return "pending";
  return event.reconciled ? "reconciled" : "mismatch";
}

export function reconciliationMeta(state: ReconciliationState): Semantic {
  switch (state) {
    case "reconciled":
      return {
        label: "reconciled",
        color: "var(--success)",
        bg: "rgba(38, 214, 138, 0.1)",
        border: "rgba(38, 214, 138, 0.35)",
      };
    case "mismatch":
      return {
        label: "mismatch",
        color: "var(--error)",
        bg: "rgba(242, 89, 89, 0.1)",
        border: "rgba(242, 89, 89, 0.35)",
      };
    case "pending":
    default:
      return {
        label: "pending",
        color: "var(--text-tertiary)",
        bg: "transparent",
        border: "var(--border-default)",
      };
  }
}

/** Distinct sorted values of a field across the loaded events (for filter dropdowns). */
export function distinctValues(events: TelemetryEvent[], pick: (e: TelemetryEvent) => string): string[] {
  const set = new Set<string>();
  for (const e of events) {
    const v = pick(e);
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
