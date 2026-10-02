import type { BudgetStatusRow } from "../../lib/api/budgets.js";

export interface BudgetTone {
  label: string;
  color: string;
  bg: string;
  border: string;
}

/**
 * Render a backend utilization ratio string (e.g. "0.250000") as a 1-decimal
 * percentage ("25.0%") using integer-scaled math — never Number() on money and
 * never floating-point accumulation. Separate from monetary parsing by design.
 */
export function formatUtilizationPercent(utilization: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(utilization.trim());
  if (!m) return "—";
  const sign = m[1] === "-" ? "-" : "";
  const whole = m[2] ?? "0";
  const frac = (m[3] ?? "").padEnd(6, "0").slice(0, 6);
  // Integer micro-ratio, then percent to one decimal: round(micro / 1000) tenths.
  const micro = Number(whole) * 1_000_000 + Number(frac);
  const tenths = Math.round(micro / 1000);
  return `${sign}${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

/** Backend status → descriptive tone (authoritative; no invented statuses/scores). */
export function budgetStatusTone(status: BudgetStatusRow["status"]): BudgetTone {
  switch (status) {
    case "over_limit":
      return { label: "over budget", color: "var(--error)", bg: "rgba(242, 89, 89, 0.12)", border: "rgba(242, 89, 89, 0.42)" };
    case "at_limit":
      return { label: "at limit", color: "var(--warn)", bg: "rgba(242, 171, 71, 0.12)", border: "rgba(242, 171, 71, 0.42)" };
    case "below_limit":
    default:
      return { label: "within budget", color: "var(--success)", bg: "rgba(38, 214, 138, 0.12)", border: "rgba(38, 214, 138, 0.42)" };
  }
}

export function budgetScopeLabel(row: Pick<BudgetStatusRow, "scope" | "clientId">): string {
  return row.scope === "global" ? "Global" : `Client${row.clientId ? ` · ${row.clientId}` : ""}`;
}

export function budgetPeriodLabel(period: BudgetStatusRow["period"]): string {
  return period === "daily" ? "Daily" : "Rolling 30d";
}

export function budgetActionLabel(action: BudgetStatusRow["action"]): string {
  return action === "block" ? "Block" : "Warn";
}

/** Utilization ratio string → clamped [0,1] fraction for a progress track. */
export function utilizationTrackValue(utilization: string): number {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(utilization.trim());
  if (!m) return 0;
  const micro = Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(6, "0").slice(0, 6));
  return Math.min(1, micro / 1_000_000);
}
