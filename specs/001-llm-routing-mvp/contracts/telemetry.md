# Telemetry Contract

**Feature**: [001-llm-routing-mvp](../spec.md) · **Plan**: [../plan.md](../plan.md) · **Data model**: [../data-model.md](../data-model.md)

This document is the versioned contract for the telemetry surface. It defines what MUST be captured for every request, how the record is shaped, and what may never appear in it. Consumers of telemetry (audit tooling, dashboards, downstream ML training) rely on this contract; breaking it is a MAJOR bump per Principle IX.

## Event schema (`TelemetryEvent`)

Canonical shape is defined in [../data-model.md#telemetryevent](../data-model.md#telemetryevent) and mirrored as a JSON schema fragment inside [http-api.yaml](./http-api.yaml). This document owns the invariants and the redaction gate.

### Required fields (MUST be present, non-null)

- `eventId` (UUID v7; identical to correlation ID / request ID) — FR-020, FR-021
- `receivedAt` (RFC 3339, UTC) — FR-020
- `clientId` — FR-020
- `decisionSource` ∈ `{ autopilot, client_override, operator_rule }` — FR-026
- `effectiveProviderId`, `effectiveModelId` — FR-020
- `attempts[]` (length 1 or 2 for MVP) — FR-034
- `aggregatedInputTokens`, `aggregatedOutputTokens`, `totalLatencyMs` — FR-020
- `terminalErrorClass` ∈ ErrorClass enum — FR-020
- `estimatedCostUsd` (Decimal, string form on the wire) — FR-020
- `pricingTableVersionId` — FR-016
- `routingRationale` (full `RoutingDecision` object) — FR-012, FR-022

### Conditionally required

- `shadowedSource` MUST be `"client_override"` when `decisionSource === "operator_rule"` and a client override was shadowed. MUST be `null` otherwise. — FR-027
- `actualCostUsd` MUST be present when every attempt reports both `inputTokens` and `outputTokens`. Otherwise `null`. — FR-018
- `reconciled` MUST be present when `actualCostUsd` is present. Computed as `abs(estimatedCostUsd − actualCostUsd) ≤ max($0.001, 0.05 × actualCostUsd)`. — FR-019a

### Fields that MUST NOT appear

- Provider API keys or any bearer tokens
- Raw request messages containing PII, secret-shaped tokens, or credit-card-shaped digits (must pass through redaction before persistence)
- Provider-specific vendor identifiers beyond `providerId` and `modelId` (Principle VI)

## Redaction gate

Before any TelemetryEvent is handed to the persistence layer, it MUST be routed through `@lca/core/redaction.applyToTelemetry(event, rules)`. The function:

- Applies the shared rule set (secrets, emails, phone numbers, credit-card digits).
- Truncates any string field derived from user input to 512 characters and appends `…[truncated]` when shortened.
- Returns a new object; the input is not mutated.

The persistence writer MUST refuse to write any event that has not passed through the gate. Detection is via a symbol-branded type (`RedactedTelemetryEvent`) that only the redaction function produces.

## Attempts chain semantics (FR-033 / FR-034 / FR-035)

- `attempts.length === 1` when either the first attempt succeeded OR the first attempt failed with a non-transient error class (`upstream_4xx`, `invalid_request`, `override_target_missing`, `context_exceeded`, `provider_unavailable`, `terminal_fallback_exhausted`).
- `attempts.length === 2` when the first attempt failed with a transient error class (`timeout`, `rate_limit`, `upstream_5xx`) AND a next candidate existed AND the request was not routed via `client_override` or `operator_rule` against an explicitly pinned target.
- `attempts[0].attemptIndex === 0`, `attempts[1].attemptIndex === 1`.
- The chain MUST NOT be extended beyond length 2 in the MVP. A future MAJOR bump may lift this bound.

## Aggregation invariants

- `aggregatedInputTokens = Σ attempts[i].inputTokens` where present; when any attempt reports null tokens, the sum is over the present ones and `actualCostUsd` is null.
- `aggregatedOutputTokens = Σ attempts[i].outputTokens` under the same rule.
- `totalLatencyMs` = wall-clock elapsed from ingress to response emission (or terminal error), NOT the sum of per-attempt latencies (which would double-count concurrent scheduler work).
- `estimatedCostUsd = Σ attempts[i].estimatedCostUsd` — every attempt has an estimate, even failed ones.

## Rollup schema (`TelemetryRollup`)

Defined in [../data-model.md#telemetryrollup](../data-model.md#telemetryrollup). Rollups are the ONLY persistent view of telemetry past the 30-day full-fidelity window (FR-023a).

### Rollup key invariants

- Exactly one row per `(rollup_date, provider_id, model_id)`.
- `rollup_date` is UTC calendar day.
- `providerId` and `modelId` are the `effectiveProviderId` / `effectiveModelId` of the underlying event (not the initial-attempt values). The first-attempt path is not preserved in rollups.

### Rollup field derivations

Given the set `E = { events with received_at ∈ [rollup_date, rollup_date+1) AND effective_provider_id = P AND effective_model_id = M }`:

- `requestCount = |E|`
- `terminalErrorCounts[c] = |{ e ∈ E : e.terminalErrorClass = c }|`
- `inputTokensSum = Σ e.aggregatedInputTokens`, same for output
- `estimatedCostSumUsd = Σ e.estimatedCostUsd`
- `actualCostSumUsd = Σ e.actualCostUsd where e.actualCostUsd IS NOT NULL`, else 0
- `latencyPercentilesMs = { p50, p95, p99 of e.totalLatencyMs over E }`
- `reconciledRate = |{ e : e.reconciled = true }| / |{ e : e.reconciled IS NOT NULL }|` (defined 0.0 when denominator is 0)
- `decisionSourceCounts[s] = |{ e ∈ E : e.decisionSource = s }|`

## Contract-test assertions

The telemetry package ships a contract test (`packages/persistence/test/telemetry.contract.test.ts`) that asserts:

- **T1**: Writer refuses non-`RedactedTelemetryEvent` inputs.
- **T2**: Round-trip: write an event, read it back through the query API, structural equality holds.
- **T3**: Aggregation produces rollups matching the derivation formulas above on a fixture set of 10 000 synthetic events.
- **T4**: Deletion of the underlying events after aggregation preserves the rollup contents.
- **T5**: Replay (see HTTP `/v1/telemetry/replay/{eventId}`) reproduces `routingRationale.candidateRanking` and `chosenModelId` exactly.
- **T6**: The reconciliation flag matches the FR-019a formula on a fixture where `estimated` and `actual` straddle both branches of the `max(0.001, 5% × actual)` piecewise threshold.
- **T7**: A fuzz test generates 1 000 events with random secret-shaped strings embedded in messages and asserts none survives in the persisted `attempts[*].raw` or `routingRationale.rationale[*].note` fields.
