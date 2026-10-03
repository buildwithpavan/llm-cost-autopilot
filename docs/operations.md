# LLM Cost Autopilot — Operations guide

Concrete playbooks for running the backend in dev, staging, and production. This document describes only functionality that is implemented and covered by tests. Anything experimental or aspirational is called out explicitly.

## Contents

1. [Environment configuration](#environment-configuration)
2. [Provider reliability (timeout + retry)](#provider-reliability-timeout--retry)
3. [Provider circuit breaker](#provider-circuit-breaker)
4. [Cost anomaly detection](#cost-anomaly-detection)
5. [Deployment shape](#deployment-shape)
6. [Database migrations](#database-migrations)
7. [Pricing snapshots](#pricing-snapshots)
8. [Provider registration and health](#provider-registration-and-health)
9. [Operator rules](#operator-rules)
10. [API keys](#api-keys)
11. [Telemetry retention and rollups](#telemetry-retention-and-rollups)
12. [Reconciliation and drift alerting](#reconciliation-and-drift-alerting)
13. [Observability endpoints](#observability-endpoints)
14. [Backup and restore](#backup-and-restore)
15. [Incident playbooks](#incident-playbooks)

---

## Environment configuration

Configuration is loaded by [packages/api/src/config.ts](../packages/api/src/config.ts) via zod. Missing or malformed values cause the API to refuse to boot.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. |
| `PORT` | no (8080) | HTTP port. |
| `NODE_ENV` | no (`development`) | Set to `production` in production. When not `production`, the API enables permissive dev CORS and registers the dev-only `POST /v1/dev/mock/arm-failure` route. The Docker image sets it to `production`. |
| `LCA_LOG_LEVEL` | no (`info`) | pino level: `fatal|error|warn|info|debug|trace`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | When set, enables OpenTelemetry OTLP HTTP trace export. |
| `OTEL_SERVICE_NAME` | no (`lca-api`) | Trace service name. |
| `LCA_BOOTSTRAP_ADMIN_KEY` | no | Reserved. Not consumed at runtime today; keys are minted via `POST /v1/keys`. |
| `OPENAI_API_KEY` | no | When set, the OpenAI adapter is registered at boot. |
| `ANTHROPIC_API_KEY` | no | When set, the Anthropic adapter is registered at boot. |
| `LCA_MOCK_FAIL_FIRST` | no | Test-only: mock adapters fail their first call with this `ErrorClass`. Do not set in production. |
| `LCA_PROVIDER_TIMEOUT_MS` | no (`30000`) | Per-attempt provider execution timeout in milliseconds. Must be a positive integer (≤ 600000). Applies to a single physical provider call, not the whole fallback chain. |
| `LCA_PROVIDER_MAX_RETRIES` | no (`0`) | Additional retries of the **same** provider candidate on a retryable failure, before fallback. Integer `0`–`5`. Default `0` preserves the reviewed fallback behavior; set `≥ 1` to opt in. |
| `LCA_PROVIDER_RETRY_BACKOFF_MS` | no (`100`) | Base backoff before the first retry, in milliseconds (non-negative integer ≤ 60000). `0` disables sleeping between retries. |
| `LCA_PROVIDER_RETRY_BACKOFF_MAX_MS` | no (`2000`) | Cap on any single backoff delay, in milliseconds (non-negative integer ≤ 120000). |
| `LCA_CIRCUIT_ENABLED` | no (`true`) | Enable the process-local provider circuit breaker. `true`/`false`. |
| `LCA_CIRCUIT_FAILURE_THRESHOLD` | no (`5`) | Consecutive provider **availability** failures (per provider) that OPEN the circuit. Positive integer (≤ 100). |
| `LCA_CIRCUIT_COOLDOWN_MS` | no (`30000`) | Time a circuit stays OPEN before allowing a single HALF_OPEN probe, in milliseconds. Positive integer (≤ 3600000). |
| `LCA_ANOMALY_MIN_HISTORY` | no (`6`) | Minimum active preceding buckets required before a bucket is evaluated for a cost anomaly. Positive integer (≤ 1000). |
| `LCA_ANOMALY_REL_THRESHOLD` | no (`0.5`) | Warning trigger: estimated cost must exceed the baseline by this fraction (e.g. `0.5` = +50%). Positive number. |
| `LCA_ANOMALY_CRIT_REL_THRESHOLD` | no (`1`) | Critical trigger: deviation above the baseline (e.g. `1` = +100%). Positive number; must be `≥ LCA_ANOMALY_REL_THRESHOLD`. |
| `LCA_ANOMALY_MIN_ABS_USD` | no (`0.010000`) | Absolute floor: a bucket's estimated cost must be at least this (decimal USD) to be flagged, suppressing tiny spikes. |

Provider credentials are read at process start only. Rotating them requires a restart.

## Provider reliability (timeout + retry)

Each physical provider call is wrapped by [packages/api/src/routing/provider-attempt.ts](../packages/api/src/routing/provider-attempt.ts) with two bounded safeguards:

- **Per-attempt timeout** (`LCA_PROVIDER_TIMEOUT_MS`, default 30 s). When a single attempt exceeds the timeout, its `AbortSignal` is aborted (cancelling in-flight work where the adapter honors it) and the attempt is recorded as a structured `timeout` failure. The timeout bounds one attempt, never the whole logical request; it never blocks the event loop.
- **Bounded per-candidate retry** (`LCA_PROVIDER_MAX_RETRIES`, default `0`). On a **retryable** failure the same provider candidate is retried up to `maxRetries` times with bounded exponential backoff (`base`, `base·2`, … capped at `LCA_PROVIDER_RETRY_BACKOFF_MAX_MS`). Total physical calls per candidate are deterministically bounded at `maxRetries + 1`.

**Retryable vs non-retryable.** Only transient infrastructure faults are retried: `timeout`, `rate_limit`, `upstream_5xx`. Everything else is terminal and never retried — deterministic client/validation errors (`invalid_request`, `context_exceeded`, `upstream_4xx`), invalid routing targets (`override_target_missing`, `provider_unavailable`), unexpected adapter throws (mapped to `provider_unavailable`), and — by construction, since they never reach provider execution — budget blocks and governance failures.

**Interaction with fallback.** Retrying a candidate is distinct from moving to the next candidate. A candidate is first retried per policy; only if it still fails with a retryable class does the existing fallback executor select the next candidate, which then runs under the same bounded policy. Provider selection order is unchanged. Retries of a candidate collapse into that candidate's single telemetry attempt, so the persisted `attempts` array still holds at most two entries (chosen + one fallback) and Phase-7 request metrics still count one logical request, one duration observation, and unchanged routing overhead per request regardless of retries.

**Budget safety.** Budget evaluation happens before provider execution and is never re-evaluated or re-reserved across retries; a budget-blocked request never enters retry logic and produces no provider attempt.


## Provider circuit breaker

A **process-local** circuit breaker ([packages/api/src/routing/circuit-breaker.ts](../packages/api/src/routing/circuit-breaker.ts)) protects each provider at the execution boundary (the narrowest point that can prevent an execution). It is enabled by default (`LCA_CIRCUIT_ENABLED`).

**States.**

- **CLOSED** — the provider executes normally. Consecutive availability failures are counted.
- **OPEN** — execution is skipped; the provider is treated as temporarily unavailable. After `LCA_CIRCUIT_COOLDOWN_MS` the next request transitions it to HALF_OPEN.
- **HALF_OPEN** — exactly one request is allowed through as a probe; concurrent requests are not admitted. A successful (or reachable, i.e. non-availability-error) probe CLOSEs the circuit; an availability-failure probe reOPENs it and restarts the cooldown.

**Transitions.** `CLOSED → OPEN` at `LCA_CIRCUIT_FAILURE_THRESHOLD` consecutive availability failures; `OPEN → HALF_OPEN` after the cooldown; `HALF_OPEN → CLOSED` on a successful probe; `HALF_OPEN → OPEN` on a failed probe. A successful CLOSED execution resets the consecutive-failure count. Each transition is logged (`provider circuit transition`, provider id + direction only — never request content) and reflected in metrics.

**Which errors trip it.** Only provider **availability** failures contribute: `timeout`, `rate_limit`, `upstream_5xx`, `provider_unavailable`. Deterministic client/validation/routing errors (`upstream_4xx`, `invalid_request`, `context_exceeded`, `override_target_missing`) never trip the circuit. Governance failures and budget blocks never reach provider execution, so they can never affect circuit state.

**Retry interaction (Phase 8).** The circuit check happens once per provider **candidate**, before execution; if admitted, the Phase 8 timeout/retry policy runs normally and the single logical outcome (success, or the final failure after retries) updates the circuit. Retry depth therefore never multiplies circuit failure accounting — `maxRetries` does not change circuit sensitivity.

**Fallback interaction.** An OPEN circuit is a *skip*, not an execution: no adapter call, no timeout/retry, and no `execution.*` stream event. The skip is surfaced as a `provider_unavailable` candidate outcome, so the existing fallback executor moves to the next candidate (fallback eligibility now includes `provider_unavailable`). Provider ordering is unchanged. If every candidate's circuit is OPEN, the request terminates with the existing `terminal_fallback_exhausted` (HTTP 502) contract.

**Budget interaction.** Circuit state never bypasses budget checks, never triggers budget re-evaluation, and never creates budget audit records or spend. A budget-blocked request touches no provider and therefore no circuit state.

**State ownership & limitations.** Circuit state is in-memory and **per process**:

- it **resets on process restart**;
- the circuit metrics below are **process-local** (not aggregated across replicas);
- this MVP does **not** provide cross-instance / distributed circuit coordination.

It is intentionally separate from the persisted provider-health probe scheduler (`provider_health_state`): the scheduler reacts to periodic `probeHealth()` calls and gates routing *candidate* selection, whereas the circuit breaker reacts to real completion-execution outcomes and gates *execution*. Neither resets the other's counters.

**Metrics** (bounded, no provider/model/client labels):

- `lca_circuit_open_providers` (gauge) — providers currently OPEN.
- `lca_circuit_transitions_total{to}` (counter) — transitions by destination state (`open`/`half_open`/`closed`).
- `lca_circuit_blocked_total` (counter) — executions skipped due to an OPEN circuit.

A request skipped because a provider circuit is OPEN remains exactly one logical request (`lca_requests_total`, `lca_request_duration_seconds`, and `lca_routing_overhead_ms` semantics are unchanged).


## Cost anomaly detection

`GET /v1/telemetry/anomalies` ([packages/persistence/src/telemetry/anomalies.ts](../packages/persistence/src/telemetry/anomalies.ts)) flags buckets whose cost is unusually high relative to their own recent history. It is **deterministic and fully explainable** — there is no ML, forecasting, scoring model, background worker, or new storage. The whole calculation runs as one bounded SQL query over raw `telemetry_events` using exact PostgreSQL `NUMERIC` arithmetic (no floating point).

**Algorithm (per completed bucket, oldest→newest):**

1. Build the contiguous, zero-filled bucket series for the filtered population (same `since`/`until`/`bucket`/`clientId`/`providerId`/`modelId` rules and 30-day maximum window as `/v1/telemetry/timeseries`). The internal lower bound is extended before `since` by the baseline lookback so early targets have context; the public response stays within `[since, until)`.
2. **Baseline** = mean **estimated** cost of the *active* buckets (those with requests) among the immediately preceding lookback window — **24 buckets for `hour`, 14 for `day`** — excluding the target bucket itself.
3. A bucket is flagged only when **all** hold:
   - at least `LCA_ANOMALY_MIN_HISTORY` active preceding buckets exist (otherwise it is not evaluated — no fabricated baseline);
   - baseline > 0;
   - estimated cost ≥ `LCA_ANOMALY_MIN_ABS_USD` (absolute floor — suppresses tiny spikes);
   - `estimated − baseline ≥ baseline × LCA_ANOMALY_REL_THRESHOLD` (relative deviation).
4. **Severity** is `critical` when `estimated − baseline ≥ baseline × LCA_ANOMALY_CRIT_REL_THRESHOLD`, otherwise `warning`.

**Boundaries.** The bucket containing "now" is **incomplete** and is never evaluated (it is naturally partial). The target bucket is never part of its own baseline. Results are ordered by bucket time and are **not** ranked against each other.

**Basis & limitations.** The signal is **estimated** cost (available immediately and consistently); actual/reconciled cost is not used and reconciliation gaps never create anomalies. Filters apply to both the target and its baseline (filtered current is never compared to unfiltered history). Buckets with a zero-cost baseline are not evaluated. V1 detects upward cost deviations only. The endpoint does **not** deliver alerts, send notifications, or take any automatic remediation/budget/routing action — it is read-only reporting.

Each returned anomaly is explainable from its fields alone: *"estimated cost was `estimatedCostUsd`, the baseline was `baselineEstimatedCostUsd`, a difference of `deviationUsd` (`deviationPercent`%) across `historicalBucketCount` historical buckets → `severity`."*


## Deployment shape

Reference deployment: a single Node.js 22 container (image built from [docker/Dockerfile](../docker/Dockerfile), final stage `gcr.io/distroless/nodejs22-debian12`, non-root user `65532:65532`) fronted by a reverse proxy, talking to PostgreSQL 16.

For local development use [docker/docker-compose.dev.yml](../docker/docker-compose.dev.yml).

The MVP is single-tenant and single-node per deployment. Horizontal scaling is possible for the request path — telemetry writes are batched but not queued, and retention runs in-process under a Postgres advisory lock, so multiple replicas coexist safely. There is no support for tenant isolation today.

On `SIGINT`/`SIGTERM` the API shuts down gracefully: it stops the retention, health-probe, and reconciliation schedulers, flushes the batched telemetry writer, then closes the HTTP server and database pool and exits 0.

## Database migrations

Migrations live under [db/migrations/](../db/migrations/) and are applied by [packages/persistence/src/db/migrate.ts](../packages/persistence/src/db/migrate.ts). Never edit an already-applied migration — add a new one.

```bash
# apply
DATABASE_URL=postgres://... npm run db:migrate
```

The API refuses to boot when no pricing table has `is_active = TRUE`. Seed a pricing snapshot before first boot.

## Pricing snapshots

Pricing tables are stored in `pricing_tables` (version metadata) + `pricing_entries` (per-model unit costs). Exactly one row has `is_active = TRUE` (enforced by a partial unique index).

Snapshots are versioned data under [db/seeds/pricing/](../db/seeds/pricing/). To roll a new snapshot:

1. Add a file `db/seeds/pricing/<YYYY-MM-DD>.json` with a unique `versionIdPrefix` and per-model entries. Example: [db/seeds/pricing/2026-09-08.json](../db/seeds/pricing/2026-09-08.json).
2. Run `npm run db:seed` — the seed loader activates the new version atomically and marks earlier versions inactive.
3. In-flight requests continue to reference the version pinned at ingress. There is no mid-request switch.

Every persisted `TelemetryEvent.pricingTableVersionId` foreign-keys into `pricing_tables.version_id`. Never delete an active or referenced version.

## Provider registration and health

Adapters are registered at API startup in [packages/api/src/index.ts](../packages/api/src/index.ts):

- Mock adapters (`mock-cheap`, `mock-fast`) are always registered — safe for tests and local dev.
- OpenAI and Anthropic adapters are registered only when the corresponding API-key env var is set.

Health state lives in `provider_health_state`. The scheduler in [packages/persistence/src/health/scheduler.ts](../packages/persistence/src/health/scheduler.ts) probes each adapter every 30 s, flips to `unhealthy` after 3 consecutive failures, and back to `healthy` on a successful probe. Unhealthy providers are excluded from routing candidates (see [tests](../packages/api/test/integration/unhealthy-exclusion.test.ts)). When every provider is unhealthy, `POST /v1/completions` returns `422 provider_unavailable` and no provider call is made.

To manually mark a provider unhealthy (e.g., during an outage), update `provider_health_state` directly in Postgres. The scheduler will not automatically flip it back until a probe succeeds.

Adding a new provider:

```
node scripts/scaffold-provider.mjs --name my-provider
```

Then implement the adapter, add its pricing entries to the current snapshot, register it in `packages/api/src/index.ts`, and add a contract test that wires the shared suite in [packages/providers/src/contract-tests/index.ts](../packages/providers/src/contract-tests/index.ts). No changes to `packages/core/**` are required or permitted (CI enforces this).

## Operator rules

Operator rules force matching requests to a specific provider/model regardless of the autopilot's cost-optimization score. Precedence: **operator rule > client override > autopilot**. A client override that is shadowed by a matching operator rule is recorded on the `TelemetryEvent.shadowedSource` field.

Rules are managed via `GET|POST /v1/operator/rules` and `PATCH|DELETE /v1/operator/rules/{ruleId}`, or the mirror `lca rules …` commands. Each rule has:

- `priority` — lower number wins when multiple rules match; alphabetical `ruleId` breaks ties.
- `enabled` — disabled rules are ignored.
- `match` — a predicate over the normalized request: `clientIds`, `requiredCapabilities`, `minEstimatedTokens`, `maxEstimatedTokens`. `null` means "match any".
- `pin` — the forced target. At least one of `providerId` or `modelId` MUST be non-null.

Rule creation invalidates the in-memory cache used by the request path. Two consecutive `list`/`snapshot` calls without a write share the same cached array reference for zero-cost hot-path evaluation.

Example: pin all requests from client `acme-prod` that require `tool_use` to `openai:gpt-4o`:

```json
{
  "priority": 10,
  "enabled": true,
  "match": {
    "clientIds": ["acme-prod"],
    "requiredCapabilities": ["tool_use"],
    "minEstimatedTokens": null,
    "maxEstimatedTokens": null
  },
  "pin": { "providerId": "openai", "modelId": "openai:gpt-4o" }
}
```

## API keys

Keys are minted via `POST /v1/keys` (or `lca keys create`). The plaintext secret is returned **exactly once**; subsequent list/get calls never include it. Storage: Argon2id hash + `client_id` + `label` + created/revoked timestamps.

**Bootstrapping the first key.** `POST /v1/keys` is itself authenticated, `db:seed` does not create a key, and `LCA_BOOTSTRAP_ADMIN_KEY` is not consumed — so the first key must be minted directly against the database, once, after `npm run build` and `npm run db:seed`:

```bash
DATABASE_URL=postgres://lca:lca@localhost:5432/lca node -e "
import('./packages/persistence/dist/index.js').then(async (p) => {
  const db = p.createDb(p.createPool(process.env.DATABASE_URL));
  const { secret } = await p.createApiKey(db, { clientId: 'admin', label: 'bootstrap' });
  console.log(secret);
  await db.destroy();
});
"
```

Every subsequent key is then minted through `POST /v1/keys` / `lca keys create` authenticated with an existing key.

The auth plugin uses an in-memory verify cache (60-second TTL, max 4096 entries) keyed on the presented bearer token. This keeps the Argon2 verify (~100 ms) off the request hot path so a single node can sustain the 100 rps sustained / 500 rps burst target (SC-011). Revoking a key immediately invalidates its cache entry, so revocation is effective on the next request.

Rotation:

```
lca keys create --client-id acme-prod --label 'rotated-2026-09'   # returns SECRET
# distribute SECRET to the client
lca keys revoke <old-keyId>
```

## Telemetry retention and rollups

The retention scheduler in [packages/persistence/src/telemetry/retention.ts](../packages/persistence/src/telemetry/retention.ts) runs every 15 minutes under a Postgres advisory lock and:

1. Aggregates events older than 30 days into `telemetry_rollups` (day × provider × model).
2. Deletes the aggregated events from `telemetry_events`.
3. Deletes rollups older than 12 months.

Aggregation is idempotent (`INSERT ... ON CONFLICT DO UPDATE`). Rollups outlive the underlying events. Full-fidelity replay (`GET /v1/telemetry/replay/{eventId}`) is available only within the 30-day window; after that the record is aggregated away.

To manually run retention:

```
node -e "
import('./packages/persistence/dist/index.js').then(async p => {
  const pool = p.createPool(process.env.DATABASE_URL);
  const db = p.createDb(pool);
  const job = p.createRetentionJob(db);
  console.log(await job.runOnce());
  await db.destroy();
});
"
```

## Reconciliation and drift alerting

The reconciliation metric loop ([packages/api/src/plugins/reconciliation-metric.ts](../packages/api/src/plugins/reconciliation-metric.ts)) refreshes `lca_reconciliation_rate` every 30 s over the FR-019a window (trailing 60 minutes OR 1000 most-recent reconcilable requests, whichever closes first). The gauge `lca_reconciliation_alert_active` flips to `1` when the rate drops below 95% and clears after one full window at ≥ 95%.

The formula is centralised in [packages/core/src/cost/reconcile.ts](../packages/core/src/cost/reconcile.ts): `abs(est − actual) ≤ max($0.001, 5% × actual)`.

When the alert fires:

1. Inspect recent `telemetry_events` where `reconciled = FALSE`.
2. Check whether a new pricing snapshot was loaded recently — a stale estimator against a new snapshot is a common cause.
3. Compare `attempts[i].estimatedCostUsd` vs `attempts[i].actualCostUsd`.

## Observability endpoints

- `GET /metrics` (public) — Prometheus text format. Live series: `lca_reconciliation_rate` and `lca_reconciliation_alert_active` (refreshed every 30 s by the reconciliation loop), `lca_budget_utilization` and `lca_budget_alert_active` (refreshed by the budget loop), the request-level families below, plus default Node.js process metrics. All series are process-local (not cross-replica aggregated); point your scraper at each replica.
  - `lca_requests_total{outcome}` (counter) — one increment per completion request that enters the `/v1/completions` handler, keyed only by the bounded `outcome` label `{success, client_error, provider_error, budget_blocked, internal_error}`. A budget block counts as one request with `outcome="budget_blocked"` (no provider is executed). Fallback chains count once per request, not once per attempt. No per-client, per-provider, per-model, or per-budget labels — cardinality is intentionally bounded.
  - `lca_request_duration_seconds` (histogram, unlabelled) — one observation per completion request, measured monotonically (`process.hrtime`) from handler entry to the terminal outcome (success, provider failure, fallback exhaustion, budget block, or validation/internal failure). Retries/attempts are not observed separately.
  - `lca_routing_overhead_ms` (histogram, unlabelled) — milliseconds spent in the routing/decision phase (governance resolution + decision build) only. It excludes catalog load, budget evaluation, and provider execution, and is observed only for requests that finalize a routing decision — requests rejected before routing (e.g. schema validation failures) produce no observation.
  - `lca_circuit_open_providers` (gauge), `lca_circuit_transitions_total{to}` (counter), `lca_circuit_blocked_total` (counter) — process-local provider circuit breaker aggregates; no provider/model/client labels. See [Provider circuit breaker](#provider-circuit-breaker).
  - For request-level breakdowns that need per-client/per-provider detail, use per-request telemetry (`GET /v1/telemetry/events`); the metrics above are deliberately low-cardinality.
- `x-request-id` header — echoed on every response and used as the `TelemetryEvent.eventId`. Propagated into pino log lines (`reqId`) and OpenTelemetry span attributes.
- `GET /v1/health` (public) — reports DB reachability and active pricing.
- pino JSON logs to stdout — redaction paths cover `req.headers.authorization` and `req.headers["x-api-key"]`.

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to enable trace export.

## Backup and restore

Standard PostgreSQL backup applies. The critical tables to back up regularly are:

- `pricing_tables` + `pricing_entries` — required for boot and for telemetry-cost audits.
- `api_keys` — needed to authenticate existing clients after restore.
- `operator_rules` — governance state.
- `telemetry_rollups` — long-range trend data.
- `telemetry_events` — auditable per-request record (large; retention already caps to 30 days).

`provider_health_state` is transient and self-heals via the probe scheduler.

## Incident playbooks

### The API refuses to boot with "no active pricing_tables row"

Run `npm run db:seed` after `npm run db:migrate`. The API deliberately refuses to boot when no pricing snapshot is active — cost figures would otherwise be silently zero.

### Every completion is failing with 502 upstream_5xx

1. `GET /v1/health` — confirms the API and DB are up.
2. `lca telemetry query --limit 20 --json | jq '.events[] | select(.terminalErrorClass != "none") | {eventId, effectiveProviderId, terminalErrorClass}'` — recent failing requests by provider. Per-request telemetry (not `/metrics`) carries this; there is no per-provider request metric today.
3. Check `provider_health_state` table — an unhealthy provider is being routed to via an operator rule that pins it. Disable that rule or restore provider health.
4. If it's a real upstream outage, the fallback contract (FR-033) automatically retries the next candidate exactly once for `timeout`, `rate_limit`, and `upstream_5xx`. If the fallback candidate is also broken, the response terminates with `terminal_fallback_exhausted`.

### `lca_reconciliation_alert_active = 1`

See [Reconciliation and drift alerting](#reconciliation-and-drift-alerting) above.

### Suspected secret leak

Run:

```
node scripts/audit-secrets.mjs
```

The audit injects a distinctive secret into the test-run env, runs the entire test suite, dumps `telemetry_events`, and greps every captured byte for the injected value. Exit 0 iff zero occurrences.
