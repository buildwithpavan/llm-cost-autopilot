import type { OperatorRuleInput } from "../../../types/index.js";

/**
 * Builds the minimal PATCH body for an enable/disable action. Intentionally
 * carries only `enabled` so a toggle never mutates match/pin/priority.
 */
export function enabledPatch(next: boolean): Pick<OperatorRuleInput, "enabled"> {
  return { enabled: next };
}
