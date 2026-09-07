# Data Model: LLM Cost Autopilot MVP

**Feature**: [001-llm-routing-mvp](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-09-08

This document defines the domain types (owned by `@lca/core`) and the persistent schema (owned by `@lca/persistence`). Field-level validation rules trace back to specific spec requirements.

## Domain types (`@lca/core/types`)

These are pure TypeScript types with zod schemas. No I/O. Every persistent record and every external contract in `contracts/` derives from one of these.

### `NormalizedRequest`

Provider-neutral internal representation of an incoming client request.

| Field | Type | Notes | Traces to |
|-------|------|-------|-----------|
| `requestId` | `string` (UUID v7) | Assigned at ingress; identical to correlation ID | FR-021 |
| `clientId` | `string` | Resolved from API key at auth time | FR-037 |
| `receivedAt` | `string` (RFC 3339) | Ingress timestamp | FR-020 |
| `messages` | `Message[]` | `{ role: "system" \| "user" \| "assistant"; content: string }` | FR-001 |
| `requirements` | `RequestRequirements` | See below | FR-003 |
| `override` | `ClientOverride \| null` | Optional per-request override | FR-024 |
| `estimatedInputTokens` | `number` (int ≥ 0) | Filled by evaluation stage | FR-017 |

### `RequestRequirements`

| Field | Type | Notes |
|-------|------|-------|
| `maxLatencyMs` | `number \| null` | Ceiling for expected model latency; nulls skip the filter |
| `maxCostUsd` | `Decimal \| null` | Ceiling for estimated request cost |
| `minQualityTier` | `"low" \| "standard" \| "high" \| null` | Nulls default to "standard" |
| `requiredCapabilities` | `Capability[]` | Any of `tool_use`, `json_mode`, `function_calling`, `vision` |

### `ClientOverride`

| Field | Type | Notes |
|-------|------|-------|
| `providerId` | `string \| null` | If set, pin the provider |
| `modelId` | `string \| null` | If set, pin the model |

Validation: at least one of `providerId` or `modelId` MUST be set when `override` is non-null.

### `Model`

Static capability/pricing metadata for one model on one provider. Loaded from the catalog config.

| Field | Type | Notes | Traces to |
|-------|------|-------|-----------|
| `modelId` | `string` | Stable identifier, e.g. `openai:gpt-4o-mini` | — |
| `providerId` | `string` | Owning provider | — |
| `capabilities` | `Capability[]` | Declared capabilities | FR-010 |
| `contextWindow` | `number` (int > 0) | Max total tokens | FR-030 |
| `qualityTier` | `"low" \| "standard" \| "high"` | Human-declared quality band | FR-010 |
| `publishedLatencyProfile` | `{ p50Ms: number; p95Ms: number }` | Used by routing filter | FR-010 |
| `publishedReliabilityScore` | `number` (0.0–1.0) | Used by routing scoring | FR-010 |
| `pricingDescriptorRef` | `string` | Foreign key into active pricing table's `(pricingTableVersionId, modelId)` | FR-016 |

### `PricingTable`

Versioned, immutable pricing data.

| Field | Type | Notes | Traces to |
|-------|------|-------|-----------|
| `versionId` | `string` (ULID) | Stable, monotonic | FR-015 / FR-016 |
| `effectiveFrom` | `string` (RFC 3339) | When this version becomes live | FR-015 |
| `entries` | `PricingEntry[]` | See below | FR-015 |

### `PricingEntry`

| Field | Type | Notes |
|-------|------|-------|
| `modelId` | `string` | |
| `providerId` | `string` | |
| `unitInputUsdPerToken` | `Decimal` | Deterministic Decimal, 6+ dp |
| `unitOutputUsdPerToken` | `Decimal` | |
| `currency` | `"USD"` | MVP fixes USD (see research.md) |

### `RoutingDecision`

Produced by `@lca/core/routing`.

| Field | Type | Notes | Traces to |
|-------|------|-------|-----------|
| `decisionSource` | `"autopilot" \| "client_override" \| "operator_rule"` | | FR-026 |
| `shadowedSource` | `"client_override" \| null` | Non-null only when an operator rule shadowed a client override | FR-027 |
| `candidateRanking` | `CandidateScore[]` | Ordered list; index 0 is chosen (before fallback) | FR-010 / FR-011 / FR-012 |
| `chosenModelId` | `string` | | FR-004 |
| `chosenProviderId` | `string` | | FR-004 |
| `rationale` | `RationaleEntry[]` | Machine-readable factor breakdown | FR-012 |
| `pricingTableVersionId` | `string` | Pricing snapshot pinned for this request | FR-016 |
| `estimatedCostUsd` | `Decimal` | Pre-call estimate for the chosen model | FR-017 |

### `CandidateScore`

| Field | Type | Notes |
|-------|------|-------|
| `providerId` | `string` | |
| `modelId` | `string` | |
| `included` | `boolean` | False when a hard filter (capability, context, latency ceiling, health) rejected it |
| `exclusionReason` | `string \| null` | Human-readable reason when `included = false` |
| `scoreBreakdown` | `Record<string, number>` | Named factors: `costScore`, `latencyScore`, `qualityScore`, `reliabilityScore`, `capabilityScore`, `total` |

### `RationaleEntry`

| Field | Type | Notes |
|-------|------|-------|
| `factor` | `string` | e.g. `"cost"`, `"latency_ceiling"`, `"capability_match"`, `"tiebreaker"` |
| `verdict` | `"eliminated" \| "preferred" \| "neutral"` | |
| `note` | `string` | Short human string |

### `OperatorRule`

Loaded from the DB (`operator_rules`) and cached in-process with an invalidation channel.

| Field | Type | Notes | Traces to |
|-------|------|-------|-----------|
| `ruleId` | `string` (ULID) | | FR-025 |
| `priority` | `number` (int) | Lower value evaluated first | FR-025 |
| `match` | `RuleMatch` | Predicate over the normalized request | FR-025 |
| `pin` | `{ providerId?: string; modelId?: string }` | At least one required | FR-025 |
| `enabled` | `boolean` | | FR-025 |
| `createdAt` / `updatedAt` | `string` (RFC 3339) | | — |

### `RuleMatch`

| Field | Type | Notes |
|-------|------|-------|
| `clientIds` | `string[] \| null` | Match any of these client IDs; null = any |
| `requiredCapabilities` | `Capability[] \| null` | Match requests requiring all of these; null = any |
| `minEstimatedTokens` | `number \| null` | Match when estimated tokens ≥ this |
| `maxEstimatedTokens` | `number \| null` | Match when estimated tokens ≤ this |

### `Attempt`

One execution attempt against a specific model/provider.

| Field | Type | Notes | Traces to |
|-------|------|-------|-----------|
| `attemptIndex` | `number` (int ≥ 0) | 0 = initial, 1 = fallback | FR-034 |
| `providerId` | `string` | | FR-034 |
| `modelId` | `string` | | FR-034 |
| `startedAt` / `endedAt` | `string` (RFC 3339) | | FR-034 |
| `latencyMs` | `number` (int ≥ 0) | Per-attempt | FR-034 |
| `inputTokens` | `number \| null` | From provider when returned | FR-034 |
| `outputTokens` | `number \| null` | From provider when returned | FR-034 |
| `errorClass` | `ErrorClass \| null` | See enum | FR-032 / FR-034 |
| `estimatedCostUsd` | `Decimal` | | FR-016 |
| `actualCostUsd` | `Decimal \| null` | Present only when provider reported usage | FR-018 / FR-019 |
| `pricingTableVersionId` | `string` | | FR-016 |

### `ErrorClass` (enum)

`"none" | "timeout" | "rate_limit" | "upstream_5xx" | "upstream_4xx" | "invalid_request" | "context_exceeded" | "override_target_missing" | "provider_unavailable" | "terminal_fallback_exhausted"`

### `TelemetryEvent`

The durable per-request record.

| Field | Type | Notes | Traces to |
|-------|------|-------|-----------|
| `eventId` | `string` (UUID v7) | Same as `requestId` | FR-020 |
| `receivedAt` | `string` (RFC 3339) | | FR-020 |
| `clientId` | `string` | | FR-020 |
| `decisionSource` | `RoutingDecision["decisionSource"]` | | FR-026 |
| `shadowedSource` | `RoutingDecision["shadowedSource"]` | | FR-027 |
| `effectiveProviderId` | `string` | Provider that ultimately produced the terminal result | FR-020 |
| `effectiveModelId` | `string` | Model that ultimately produced the terminal result | FR-020 |
| `attempts` | `Attempt[]` | Ordered chain; length ∈ {1, 2} for MVP | FR-034 |
| `aggregatedInputTokens` | `number` (int ≥ 0) | Sum across successful attempts | FR-020 |
| `aggregatedOutputTokens` | `number` (int ≥ 0) | Sum across successful attempts | FR-020 |
| `totalLatencyMs` | `number` (int ≥ 0) | End-to-end wall clock | FR-020 |
| `terminalErrorClass` | `ErrorClass` | Terminal outcome of the request | FR-020 |
| `estimatedCostUsd` | `Decimal` | Sum of per-attempt estimates | FR-020 |
| `actualCostUsd` | `Decimal \| null` | Sum of per-attempt actuals if all present | FR-018 |
| `pricingTableVersionId` | `string` | Version pinned at request time | FR-016 |
| `reconciled` | `boolean \| null` | Computed via FR-019a; null when `actualCostUsd` is null | FR-019a |
| `routingRationale` | `RoutingDecision` | Full decision object, minus PII in candidate reasons | FR-012 / FR-022 |

Validation invariants (enforced in `@lca/core/telemetry`):
- If `decisionSource === "operator_rule"` then `shadowedSource` MAY be `"client_override"`; if `decisionSource !== "operator_rule"` then `shadowedSource` MUST be `null`.
- `attempts.length ≤ 2` for MVP (FR-033).
- If `terminalErrorClass === "none"`, the last attempt's `errorClass` is `"none"`.
- If `attempts.length === 2`, `attempts[0].errorClass` is one of `timeout | rate_limit | upstream_5xx` (FR-033).

### `TelemetryRollup`

| Field | Type | Notes | Traces to |
|-------|------|-------|-----------|
| `rollupDate` | `string` (`YYYY-MM-DD`, UTC) | Partition key | FR-023a |
| `providerId` | `string` | | FR-023a |
| `modelId` | `string` | | FR-023a |
| `requestCount` | `number` (int ≥ 0) | | FR-023a |
| `terminalErrorCounts` | `Record<ErrorClass, number>` | | FR-023a |
| `inputTokensSum` | `number` (int ≥ 0) | | FR-023a |
| `outputTokensSum` | `number` (int ≥ 0) | | FR-023a |
| `estimatedCostSumUsd` | `Decimal` | | FR-023a |
| `actualCostSumUsd` | `Decimal` | 0 when no actuals | FR-023a |
| `latencyPercentilesMs` | `{ p50: number; p95: number; p99: number }` | | FR-023a |
| `reconciledRate` | `number` (0.0–1.0) | Over requests with actuals | FR-023a |
| `decisionSourceCounts` | `Record<"autopilot" \| "client_override" \| "operator_rule", number>` | | FR-023a |
| `aggregatedAt` | `string` (RFC 3339) | | FR-023a |

### `ApiKey`

| Field | Type | Notes | Traces to |
|-------|------|-------|-----------|
| `keyId` | `string` (ULID) | Prefix of the token shown to clients for lookup | FR-036 / FR-037 |
| `hashedSecret` | `string` | Argon2id hash | FR-036 |
| `clientId` | `string` | Owner identifier | FR-037 |
| `label` | `string` | Human label; free-form | — |
| `createdAt` | `string` (RFC 3339) | | — |
| `revokedAt` | `string \| null` (RFC 3339) | | — |
| `lastUsedAt` | `string \| null` (RFC 3339) | | — |

### `ProviderHealthState`

| Field | Type | Notes | Traces to |
|-------|------|-------|-----------|
| `providerId` | `string` | | FR-029 |
| `healthy` | `boolean` | | FR-029 |
| `lastProbedAt` | `string` (RFC 3339) | | FR-029 |
| `consecutiveFailures` | `number` (int ≥ 0) | | FR-029 |
| `updatedAt` | `string` (RFC 3339) | | FR-029 |

## Persistent schema (PostgreSQL 16)

All monetary columns are `NUMERIC(20, 6)`. All timestamps are `TIMESTAMPTZ`. All identifier columns are `TEXT` unless noted.

### `pricing_tables`

```sql
CREATE TABLE pricing_tables (
  version_id      TEXT PRIMARY KEY,
  effective_from  TIMESTAMPTZ NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX pricing_tables_one_active
  ON pricing_tables (is_active)
  WHERE is_active = TRUE;
```

### `pricing_entries`

```sql
CREATE TABLE pricing_entries (
  version_id                 TEXT NOT NULL REFERENCES pricing_tables(version_id) ON DELETE RESTRICT,
  provider_id                TEXT NOT NULL,
  model_id                   TEXT NOT NULL,
  unit_input_usd_per_token   NUMERIC(20, 10) NOT NULL,
  unit_output_usd_per_token  NUMERIC(20, 10) NOT NULL,
  currency                   TEXT NOT NULL DEFAULT 'USD',
  PRIMARY KEY (version_id, provider_id, model_id)
);
```

### `telemetry_events`

```sql
CREATE TABLE telemetry_events (
  event_id                    UUID PRIMARY KEY,
  received_at                 TIMESTAMPTZ NOT NULL,
  client_id                   TEXT NOT NULL,
  decision_source             TEXT NOT NULL
    CHECK (decision_source IN ('autopilot','client_override','operator_rule')),
  shadowed_source             TEXT
    CHECK (shadowed_source IN ('client_override') OR shadowed_source IS NULL),
  effective_provider_id       TEXT NOT NULL,
  effective_model_id          TEXT NOT NULL,
  attempts                    JSONB NOT NULL,
  aggregated_input_tokens     INTEGER NOT NULL,
  aggregated_output_tokens    INTEGER NOT NULL,
  total_latency_ms            INTEGER NOT NULL,
  terminal_error_class        TEXT NOT NULL,
  estimated_cost_usd          NUMERIC(20, 6) NOT NULL,
  actual_cost_usd             NUMERIC(20, 6),
  pricing_table_version_id    TEXT NOT NULL REFERENCES pricing_tables(version_id),
  reconciled                  BOOLEAN,
  routing_rationale           JSONB NOT NULL
) PARTITION BY RANGE (received_at);

CREATE INDEX telemetry_events_client_time
  ON telemetry_events (client_id, received_at DESC);

CREATE INDEX telemetry_events_effective_model
  ON telemetry_events (effective_provider_id, effective_model_id, received_at DESC);
```

Partition management: monthly partitions created by a migration + a scheduled job that creates the next month's partition on the 25th of each month.

### `telemetry_rollups`

```sql
CREATE TABLE telemetry_rollups (
  rollup_date              DATE NOT NULL,
  provider_id              TEXT NOT NULL,
  model_id                 TEXT NOT NULL,
  request_count            INTEGER NOT NULL,
  terminal_error_counts    JSONB NOT NULL,
  input_tokens_sum         BIGINT NOT NULL,
  output_tokens_sum        BIGINT NOT NULL,
  estimated_cost_sum_usd   NUMERIC(20, 6) NOT NULL,
  actual_cost_sum_usd      NUMERIC(20, 6) NOT NULL,
  latency_p50_ms           INTEGER NOT NULL,
  latency_p95_ms           INTEGER NOT NULL,
  latency_p99_ms           INTEGER NOT NULL,
  reconciled_rate          NUMERIC(5, 4) NOT NULL,
  decision_source_counts   JSONB NOT NULL,
  aggregated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rollup_date, provider_id, model_id)
);
```

### `operator_rules`

```sql
CREATE TABLE operator_rules (
  rule_id     TEXT PRIMARY KEY,
  priority    INTEGER NOT NULL,
  match       JSONB NOT NULL,
  pin         JSONB NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX operator_rules_enabled_priority
  ON operator_rules (enabled, priority);
```

### `api_keys`

```sql
CREATE TABLE api_keys (
  key_id         TEXT PRIMARY KEY,
  hashed_secret  TEXT NOT NULL,
  client_id      TEXT NOT NULL,
  label          TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at     TIMESTAMPTZ,
  last_used_at   TIMESTAMPTZ
);

CREATE INDEX api_keys_client ON api_keys (client_id);
```

### `provider_health_state`

```sql
CREATE TABLE provider_health_state (
  provider_id            TEXT PRIMARY KEY,
  healthy                BOOLEAN NOT NULL,
  last_probed_at         TIMESTAMPTZ NOT NULL,
  consecutive_failures   INTEGER NOT NULL DEFAULT 0,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## State transitions

### Provider health

```
healthy = true  ── probe fail ──▶  consecutive_failures += 1
                                    if consecutive_failures ≥ 3 → healthy = false

healthy = false ── probe success ─▶ consecutive_failures = 0, healthy = true
```

The routing filter reads `healthy` synchronously via a cached view refreshed on every probe result.

### Pricing table activation

At most one `pricing_tables` row has `is_active = TRUE` at any time (partial unique index enforces this). Activation is a two-statement transaction: `UPDATE ... SET is_active = FALSE WHERE is_active`; `UPDATE ... SET is_active = TRUE WHERE version_id = $1`. In-flight requests continue to reference the version they pinned at ingress; there is no mid-request switch.

### Retention lifecycle

```
telemetry_events (received_at) ── age > 30 days ──▶ aggregate into telemetry_rollups ──▶ delete row
telemetry_rollups (rollup_date) ── age > 12 months ──▶ delete row
```

Both transitions are performed by the retention scheduler under a `pg_try_advisory_lock` (`lock_id = hashtext('lca:retention')`).

## Relationships (summary)

- `pricing_entries.version_id → pricing_tables.version_id` (RESTRICT: a version cannot be deleted while entries exist).
- `telemetry_events.pricing_table_version_id → pricing_tables.version_id` (NO ACTION: pricing versions are effectively immutable once referenced).
- `telemetry_rollups` has no FK to `pricing_tables` — it aggregates across versions.
- `operator_rules`, `api_keys`, `provider_health_state` are independent tables.
