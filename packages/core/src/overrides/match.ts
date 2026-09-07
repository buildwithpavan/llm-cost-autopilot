import type { NormalizedRequest } from "../types/request.js";
import type { OperatorRule } from "../types/governance.js";

/** Deterministic AND-semantics matcher for OperatorRule.match against a request. */
export function matchesRule(rule: OperatorRule, request: NormalizedRequest): boolean {
  if (!rule.enabled) return false;
  const m = rule.match;

  if (m.clientIds !== null && !m.clientIds.includes(request.clientId)) {
    return false;
  }

  if (m.requiredCapabilities !== null && m.requiredCapabilities.length > 0) {
    const requested = new Set(request.requirements.requiredCapabilities ?? []);
    for (const cap of m.requiredCapabilities) {
      if (!requested.has(cap)) return false;
    }
  }

  if (m.minEstimatedTokens !== null && request.estimatedInputTokens < m.minEstimatedTokens) {
    return false;
  }
  if (m.maxEstimatedTokens !== null && request.estimatedInputTokens > m.maxEstimatedTokens) {
    return false;
  }

  return true;
}
