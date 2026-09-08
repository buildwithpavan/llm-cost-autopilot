# LLM Cost Autopilot

Intelligent orchestration and cost-optimization layer that sits between your applications and multiple LLM providers.

The autopilot accepts a chat/completion request, normalizes it, deterministically selects the best-fit model/provider from a configured catalog, executes the call through a provider adapter, and returns a normalized response. Every request produces a structured, auditable telemetry record with a machine-readable rationale and a cost estimate that references a versioned pricing table. Clients and operators can override autonomous routing with a well-defined precedence (operator > client).

## Status

Backend MVP delivered end-to-end. All 111 tasks in [specs/001-llm-routing-mvp/tasks.md](specs/001-llm-routing-mvp/tasks.md) complete. Test suite: 130+ tests across the workspace, DB-backed integration included. Frontend has not been started.

## Stack

- Node.js 22+, TypeScript 5.6 strict
- Fastify 5 for the HTTP surface
- PostgreSQL 16 for durable state
- Kysely (typed SQL, no ORM) + `node-pg-migrate` for schema
- pino, prom-client, OpenTelemetry SDK for observability
- decimal.js-light for deterministic cost math
- Argon2id (`@node-rs/argon2`) for API-key hashing
- Vitest for unit/contract/integration + `vitest bench` and `autocannon` for perf
- npm workspaces monorepo · Docker · GitHub Actions

The project constitution ([.specify/memory/constitution.md](.specify/memory/constitution.md)) governs every design decision. See especially Principle I (Library-First), Principle II (CLI + API Parity), Principle III (Test-First), Principle V (Cost Accuracy), Principle VI (Provider Abstraction), and Principle X (Performance Budgets).

## Repository layout

```
packages/
  core/           @lca/core          – vendor-neutral logic: types, routing, evaluation, cost, redaction, overrides, telemetry
  providers/      @lca/providers     – provider abstraction + adapters (mock, openai, anthropic) + shared contract suite
  persistence/    @lca/persistence   – Postgres access: schema, migrations, telemetry writer/rollups/retention, auth, catalog, health
  api/            @lca/api           – Fastify HTTP entrypoint (thin shell)
  cli/            @lca/cli           – `lca` command-line (mirrors API)
db/
  migrations/     versioned SQL schema migrations
  seeds/pricing/  versioned pricing snapshots
docker/           Dockerfile + docker-compose.dev.yml
scripts/          audit-secrets, scaffold-provider
specs/            Spec Kit artifacts (spec / plan / tasks / contracts)
```

The provider-abstraction boundary is enforced by ESLint (`eslint.config.mjs`) and by [packages/core/test/no-vendor-imports.test.ts](packages/core/test/no-vendor-imports.test.ts): only `packages/providers/src/openai/*` may import `openai`; only `packages/providers/src/anthropic/*` may import `@anthropic-ai/sdk`.

## Quickstart

Prerequisites: Node.js 22+, npm 10+, Docker with Compose plugin, and free ports 5432 + 8080.

```bash
git clone https://github.com/buildwithpavan/llm-cost-autopilot.git
cd llm-cost-autopilot
npm install

# 1. Start Postgres
docker compose -f docker/docker-compose.dev.yml up -d postgres

# 2. Build the workspace
npm run build

# 3. Apply migrations + load a pricing snapshot
export DATABASE_URL=postgres://lca:lca@localhost:5432/lca
npm run db:migrate
npm run db:seed

# 4. Start the API
npm run start:api

# 5. In another shell, mint an admin API key and make a call
node -e "
import('./packages/persistence/dist/index.js').then(async p => {
  const pool = p.createPool(process.env.DATABASE_URL);
  const db = p.createDb(pool);
  const created = await p.createApiKey(db, { clientId: 'demo', label: 'quickstart' });
  console.log('SECRET=' + created.secret);
  await db.destroy();
});
"

export LCA_API_KEY="<paste-the-secret>"
curl -sS -X POST http://localhost:8080/v1/completions \
  -H "authorization: Bearer $LCA_API_KEY" \
  -H "content-type: application/json" \
  -d '{"messages":[{"role":"user","content":"hello"}]}'
```

Full scenario walkthroughs are in [specs/001-llm-routing-mvp/quickstart.md](specs/001-llm-routing-mvp/quickstart.md). Operational playbooks (deploy, migrations, providers, telemetry, retention, keys, incident response) are in [docs/operations.md](docs/operations.md).

## HTTP API

All non-`/v1/health` routes require `Authorization: Bearer <api_key>`. The canonical schema is [specs/001-llm-routing-mvp/contracts/http-api.yaml](specs/001-llm-routing-mvp/contracts/http-api.yaml).

| Route | Purpose |
|---|---|
| `GET /v1/health` (public) | Liveness + dependency health probe |
| `GET /metrics` (public) | Prometheus scrape endpoint |
| `POST /v1/completions` | Route + execute an LLM chat/completion request |
| `POST /v1/routing/preview` | Dry-run routing (no provider call, no telemetry) |
| `GET /v1/catalog` | List the current provider/model catalog |
| `GET /v1/telemetry/events` | Query full-fidelity telemetry (cursor pagination) |
| `GET /v1/telemetry/rollups` | Query daily rollups (12-month window) |
| `GET /v1/telemetry/replay/{eventId}` | Reproduce a stored routing decision (no provider call) |
| `GET \| POST /v1/operator/rules` | List / create operator routing rules |
| `PATCH \| DELETE /v1/operator/rules/{ruleId}` | Update / remove a rule |
| `GET \| POST \| DELETE /v1/keys[/{keyId}]` | Manage API keys (plaintext secret returned only on create) |

Correlation is via `x-request-id` (echoed on the response and used as `TelemetryEvent.eventId`).

## CLI

Every HTTP capability has a mirror in `lca`. See [specs/001-llm-routing-mvp/contracts/cli.md](specs/001-llm-routing-mvp/contracts/cli.md) and the parity test at [packages/api/test/contract/parity.test.ts](packages/api/test/contract/parity.test.ts).

```
lca health
lca complete --messages-file ./msgs.json [--pin-provider ID] [--pin-model ID]
lca route preview --messages-file ./msgs.json
lca catalog list
lca telemetry query [--client-id …] [--provider-id …] [--since RFC3339] [--limit N] [--cursor C]
lca telemetry rollups [--from YYYY-MM-DD] [--to YYYY-MM-DD]
lca telemetry replay <eventId>              # exits ≠ 0 on divergence
lca rules list | add --file r.json | update <id> --file r.json | delete <id>
lca keys list | create --client-id ID --label LABEL | revoke <keyId>
```

Global flags: `--json`, `--api-url`, `--api-key`, `-v`. Non-zero exit on failure; secrets never printed except on `lca keys create`.

## Provider extensibility

Adding a new provider requires only a new adapter + its contract test — the routing core is not modified. Scaffold:

```
node scripts/scaffold-provider.mjs --name my-provider
```

The generated adapter implements the `ProviderAdapter` interface from [packages/providers/src/abstraction/provider.ts](packages/providers/src/abstraction/provider.ts). The shared contract suite at [packages/providers/src/contract-tests/index.ts](packages/providers/src/contract-tests/index.ts) enforces C1–C10 from [specs/001-llm-routing-mvp/contracts/provider.md](specs/001-llm-routing-mvp/contracts/provider.md). CI blocks PRs that touch both `packages/providers/**` and `packages/core/**` unless labeled `allow-core-change`.

## Telemetry & cost accuracy

Every request produces a `TelemetryEvent` (see [specs/001-llm-routing-mvp/contracts/telemetry.md](specs/001-llm-routing-mvp/contracts/telemetry.md)) containing:

- request/event ID (correlation)
- client + effective provider/model
- ordered attempts chain (1 or 2 for MVP; second attempt only on transient failure)
- input/output tokens, latency, terminal error class
- estimated cost + actual cost + reconciliation flag
- **pricing-table version id** (FR-016 — every cost value carries this)
- full routing rationale + decision source + shadowed source

Cost reconciliation (FR-019a): a request is reconciled when `abs(est − actual) ≤ max($0.001, 5% × actual)`. The rolling window is trailing 60 minutes OR 1,000 most-recent reconcilable requests, whichever closes first; the drift alert fires when the rate drops below 95%.

Retention (FR-023a): 30 days full-fidelity events, then daily rollups keyed by `(day, provider, model)` retained for 12 months. Aggregation and deletion run under `pg_try_advisory_lock` inside the API process.

Redaction: every event passes through the `RedactedTelemetryEvent` brand gate before persistence. The [packages/core/test/redaction.fuzz.test.ts](packages/core/test/redaction.fuzz.test.ts) fuzz test verifies 1000 payloads across secrets, bearer tokens, `api_key=`, emails, phones, and card digits.

## Security

- Argon2id-hashed API keys with a per-process verify cache (60 s TTL, cleared on revoke) that keeps the request path off the Argon2 hot loop.
- Bearer authentication required on every non-public route.
- Secret material is never logged (pino `redact` paths) or persisted in telemetry.
- Vendor SDK imports are boundary-checked at lint time and at test time (T102).
- CI runs `gitleaks`, `npm audit --omit=dev --audit-level=high`, and the end-to-end secret-leak audit script.

## Development

```
npm run typecheck     # tsc --build --pretty
npm run lint          # eslint (flat config)
npm run build         # tsc --build across all packages
npm run test          # vitest run  (set RUN_DB_TESTS=1 for DB-backed integration)
npm run bench:overhead    # routing pipeline microbench (Principle X)
npm run bench:throughput  # 100 rps sustained + 500 rps burst against Mock (SC-011)
node scripts/audit-secrets.mjs   # secret-leak audit
```

The Spec Kit workflow is documented in `.github/skills/`. All work should follow the Test-First rule required by constitution Principle III.

## License

MIT. See [LICENSE](LICENSE).
