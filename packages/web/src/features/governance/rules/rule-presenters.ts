import type { Capability, RuleMatch, RulePin } from "../../../types/index.js";

/** Neutral label for an absent match condition. */
export const ANY_LABEL = "Any";

export interface MatchConditionsView {
  /** Empty array means "Any". */
  clientIds: string[];
  /** Empty array means "Any". */
  capabilities: Capability[];
  /** null means "Any". */
  tokens: string | null;
}

/** Formats token bounds as a compact range; pure string formatting only. */
export function formatTokenBounds(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return `tokens:${min}–${max}`;
  if (min !== null) return `tokens:≥${min}`;
  return `tokens:≤${max}`;
}

/** Decomposes a RuleMatch into renderable chips/labels. No matching logic. */
export function formatMatchConditions(match: RuleMatch): MatchConditionsView {
  return {
    clientIds: match.clientIds ?? [],
    capabilities: match.requiredCapabilities ?? [],
    tokens: formatTokenBounds(match.minEstimatedTokens, match.maxEstimatedTokens),
  };
}

/** True when a match view carries no conditions (renders as a single "Any"). */
export function isMatchAny(view: MatchConditionsView): boolean {
  return view.clientIds.length === 0 && view.capabilities.length === 0 && view.tokens === null;
}

/**
 * Formats a pin target. Never infers a missing side:
 * provider:model when both, provider only when modelId is null, model only when
 * providerId is null.
 */
export function formatPin(pin: RulePin): string {
  if (pin.providerId !== null && pin.modelId !== null) return `${pin.providerId}:${pin.modelId}`;
  if (pin.providerId !== null) return pin.providerId;
  if (pin.modelId !== null) return pin.modelId;
  return "—";
}

export interface EnabledView {
  label: "Enabled" | "Disabled";
  tone: "active" | "muted";
}

/** Presentation of the enabled flag. No mutation semantics. */
export function formatEnabled(enabled: boolean): EnabledView {
  return enabled ? { label: "Enabled", tone: "active" } : { label: "Disabled", tone: "muted" };
}

/** Renders the priority exactly as returned — no normalization, clamping, or reordering. */
export function formatPriority(priority: number): string {
  return String(priority);
}
