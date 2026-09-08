# LLM Cost Autopilot — Operations guide

Concrete playbooks for running the backend in dev, staging, and production. This document describes only functionality that is implemented and covered by tests. Anything experimental or aspirational is called out explicitly.

## Contents

1. [Environment configuration](#environment-configuration)
2. [Deployment shape](#deployment-shape)
3. [Database migrations](#database-migrations)
4. [Pricing snapshots](#pricing-snapshots)
5. [Provider registration and health](#provider-registration-and-health)
6. [Operator rules](#operator-rules)
7. [API keys](#api-keys)
8. [Telemetry retention and rollups](#telemetry-retention-and-rollups)
9. [Reconciliation and drift alerting](#reconciliation-and-drift-alerting)
10. [Observability endpoints](#observability-endpoints)
11. [Backup and restore](#backup-and-restore)
12. [Incident playbooks](#incident-playbooks)

---

## Environment configuration

Configuration is loaded by [packages/api/src/config.ts](../packages/api/src/config.ts) via zod. Missing or malformed values cause the API to refuse to boot.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. |
| `PORT` | no (8080) | HTTP port. |
| `LCA_LOG_LEVEL` | no (`info`) | pino level: `fatal|error|warn|info|debug|trace`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | When set, enables OpenTelemetry OTLP HTTP trace export. |
| `OTEL_SERVICE_NAME` | no (`lca-api`) | Trace service name. |
| `LCA_BOOTSTRAP_ADMIN_KEY` | no | Reserved. Not consumed at runtime today; keys are minted via `POST /v1/keys`. |
| `OPENAI_API_KEY` | no | When set, the OpenAI adapter is registered at boot. |
| `ANTHROPIC_API_KEY` | no | When set, the Anthropic adapter is registered at boot. |
| `LCA_MOCK_FAIL_FIRST` | no | Test-only: mock adapters fail their first call with this `ErrorClass`. Do not set in production. |

Provider credentials are read at process start only. Rotating them requires a restart.

## Deployment shape

Reference deployment: a single Node.js 22 container (image built from [docker/Dockerfile](../docker/Dockerfile), final stage `gcr.io/distroless/nodejs22-debian12`, non-root user `65532:65532`) fronted by a reverse proxy, talking to PostgreSQL 16.

For local development use [docker/docker-compose.dev.yml](../docker/docker-compose.dev.yml).

The MVP is single-tenant and single-node per deployment. Horizontal scaling is possible for the request path — telemetry writes are batched but not queued, and retention runs in-process under a Postgres advisory lock, so multiple replicas coexist safely. There is no support for tenant isolation today.

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

- `GET /metrics` (public) — Prometheus text format. Includes `lca_requests_total`, `lca_request_duration_seconds`, `lca_routing_overhead_ms`, `lca_reconciliation_rate`, `lca_reconciliation_alert_active`, and default Node.js process metrics.
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
2. `curl /metrics | grep provider` — look for probe failures.
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
