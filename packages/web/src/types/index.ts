/**
 * Re-export the canonical domain types from @lca/core so the frontend never
 * duplicates a schema. If a UI field is not present here, it is a UI-only
 * intermediate (place it under features/<feature>/*.types.ts instead).
 */
export type {
  Attempt,
  CandidateScore,
  Capability,
  DecisionSource,
  ErrorClass,
  OperatorRule,
  OperatorRuleInput,
  RationaleEntry,
  RoutingDecision,
  RuleMatch,
  RulePin,
  TelemetryEvent,
  TelemetryRollup,
  ApiKeyMetadata,
} from "@lca/core";
