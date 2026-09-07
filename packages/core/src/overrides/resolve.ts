import type { NormalizedRequest, ClientOverride } from "../types/request.js";
import type { OperatorRule, RulePin } from "../types/governance.js";
import type { DecisionSource } from "../types/telemetry.js";
import { matchesRule } from "./match.js";

export interface ResolveOverrideInput {
  request: NormalizedRequest;
  rules: readonly OperatorRule[];
}

export interface OverrideResolution {
  effectiveSource: DecisionSource;
  shadowedSource: "client_override" | null;
  /** Pin to apply to routing. Null means "let the autopilot decide". */
  pin: RulePin | ClientOverride | null;
  /** ID of the matched operator rule (present when effectiveSource === "operator_rule"). */
  matchedRuleId: string | null;
}

/**
 * Deterministic FR-027 precedence:
 *   operator_rule > client_override > autopilot
 *
 * When multiple operator rules match, the one with the lowest `priority` number wins.
 * When priorities tie, `ruleId` breaks the tie alphabetically for determinism.
 */
export function resolveOverride(input: ResolveOverrideInput): OverrideResolution {
  const matching = input.rules
    .filter((r) => matchesRule(r, input.request))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.ruleId.localeCompare(b.ruleId);
    });

  const clientOverride = input.request.override;
  if (matching.length > 0) {
    const rule = matching[0]!;
    return {
      effectiveSource: "operator_rule",
      shadowedSource: clientOverride ? "client_override" : null,
      pin: rule.pin,
      matchedRuleId: rule.ruleId,
    };
  }

  if (clientOverride) {
    return {
      effectiveSource: "client_override",
      shadowedSource: null,
      pin: clientOverride,
      matchedRuleId: null,
    };
  }

  return {
    effectiveSource: "autopilot",
    shadowedSource: null,
    pin: null,
    matchedRuleId: null,
  };
}
