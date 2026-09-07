---
description: "Task list for the LLM Cost Autopilot MVP (feature 001-llm-routing-mvp)"
---

# Tasks: LLM Cost Autopilot MVP

**Input**: Design documents from `/specs/001-llm-routing-mvp/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/http-api.yaml](./contracts/http-api.yaml), [contracts/cli.md](./contracts/cli.md), [contracts/provider.md](./contracts/provider.md), [contracts/telemetry.md](./contracts/telemetry.md), [quickstart.md](./quickstart.md), [.specify/memory/constitution.md](../../.specify/memory/constitution.md)

**Tests**: **Included and required.** The project constitution declares Principle III (Test-First) as NON-NEGOTIABLE. Every user-story phase writes failing tests first, then implementation.

**Organization**: Tasks are grouped by user story. Each story is independently implementable, testable, and deployable per the spec.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Story tag — `US1`, `US2`, `US3` — omitted from Setup, Foundational, and Polish phases
- Every task references at least one concrete file path in the monorepo layout defined by [plan.md](./plan.md#project-structure)

## Path Conventions

Monorepo layout from [plan.md](./plan.md#project-structure):

- `packages/core/` — `@lca/core` (vendor-neutral logic)
- `packages/providers/` — `@lca/providers` (abstraction + adapters)
- `packages/persistence/` — `@lca/persistence` (Postgres)
- `packages/api/` — `@lca/api` (Fastify shell)
- `packages/cli/` — `@lca/cli` (commander CLI)
- `db/migrations/` — `node-pg-migrate` files
- `db/seeds/` — seed data
- `docker/` — Dockerfile + compose
- `.github/workflows/` — CI

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffold the monorepo, remove stale Python scaffolding, wire tooling.

- [X] T001 Remove stale Python scaffolding: delete [pyproject.toml](../../pyproject.toml), [.python-version](../../.python-version), and [src/llm_cost_autopilot/](../../src/llm_cost_autopilot/) directory (constitution forbids Python for MVP; scaffolding predates ratification).
- [X] T002 Configure npm workspaces in [package.json](../../package.json): set `type: "module"`, `engines.node: ">=22"`, `workspaces: ["packages/*"]`, replace stray `fastify` root-level dependency, and add npm scripts (`build`, `typecheck`, `lint`, `test`, `db:migrate`, `db:seed`, `start:api`, `bench:overhead`, `bench:throughput`).
- [X] T003 [P] Create root `tsconfig.base.json` with `strict: true`, `target: "ES2023"`, `moduleResolution: "NodeNext"`, `module: "NodeNext"`, `verbatimModuleSyntax: true`.
- [X] T004 [P] Create root `.eslintrc.cjs` with `@typescript-eslint`, `import`, and a `no-restricted-imports` rule that forbids `openai` and `@anthropic-ai/sdk` outside `packages/providers/src/{openai,anthropic}/**` (enforces Principle VI).
- [X] T005 [P] Create root `.prettierrc` and `.prettierignore`.
- [X] T006 [P] Create root `vitest.workspace.ts` referencing all five packages.
- [X] T007 Scaffold `packages/core/` with `package.json` (`@lca/core`, private, entry `dist/index.js`), `tsconfig.json` extending base, `src/index.ts`, `test/` folder.
- [X] T008 [P] Scaffold `packages/providers/` (`@lca/providers`) with same shape as T007; declare peer deps on vendor SDKs (`openai`, `@anthropic-ai/sdk`).
- [X] T009 [P] Scaffold `packages/persistence/` (`@lca/persistence`) with same shape as T007; declare deps on `pg`, `kysely`, `node-pg-migrate`.
- [X] T010 [P] Scaffold `packages/api/` (`@lca/api`) with same shape as T007; declare deps on `fastify`, `@fastify/helmet`, `fastify-type-provider-zod`, `pino`, `prom-client`, `@opentelemetry/sdk-node`.
- [X] T011 [P] Scaffold `packages/cli/` (`@lca/cli`) with `bin` entry in `package.json`, deps on `commander`, `zod`, `pino`.
- [X] T012 [P] Create `.env.example` at repo root listing `DATABASE_URL`, `LCA_BOOTSTRAP_ADMIN_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LCA_LOG_LEVEL`, `OTEL_EXPORTER_OTLP_ENDPOINT`.
- [X] T013 [P] Add `docker/Dockerfile` (multi-stage: `node:22-slim` build stage → `gcr.io/distroless/nodejs22-debian12` final).
- [X] T014 [P] Add `docker/docker-compose.dev.yml` with `postgres:16` service and an `api` service wired to build the Dockerfile.
- [X] T015 [P] Add `.gitleaks.toml` config at repo root plus `.github/workflows/security.yml` (gitleaks + `npm audit --production` on PRs).
- [X] T016 [P] Add `.github/workflows/ci.yml` (install → lint → typecheck → test → coverage report → bench smoke) and `.github/workflows/release.yml` (build image on tag).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Deliver the shared infrastructure every user story depends on: database, core types, provider abstraction, redaction, cost math, observability plumbing, minimal API shell with `/v1/health` only.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete.

### Database + persistence base

- [X] T017 Create initial migration [db/migrations/1725840000000_init.sql](../../db/migrations/1725840000000_init.sql) implementing every table in [data-model.md](./data-model.md#persistent-schema-postgresql-16): `pricing_tables`, `pricing_entries`, `telemetry_events` (partitioned by month on `received_at`), `telemetry_rollups`, `operator_rules`, `api_keys`, `provider_health_state`, plus indexes.
- [X] T018 Implement pg pool + Kysely bindings in [packages/persistence/src/db/pool.ts](../../packages/persistence/src/db/pool.ts) and [packages/persistence/src/db/schema.ts](../../packages/persistence/src/db/schema.ts) (Kysely `Database` type mirrors the SQL schema).
- [X] T019 [P] Implement migration runner CLI at [packages/persistence/src/db/migrate.ts](../../packages/persistence/src/db/migrate.ts) and wire `npm run db:migrate` to it.
- [X] T020 [P] Implement seed loader at [packages/persistence/src/db/seed.ts](../../packages/persistence/src/db/seed.ts) that ingests [db/seeds/pricing/2026-09-08.json](../../db/seeds/pricing/2026-09-08.json) into `pricing_tables` + `pricing_entries` and marks the version active. API MUST refuse boot without an active version.
- [X] T021 [P] Create seed pricing snapshot at [db/seeds/pricing/2026-09-08.json](../../db/seeds/pricing/2026-09-08.json) with entries for `mock-cheap:small`, `mock-cheap:large`, `mock-fast:default`, `openai:gpt-4o-mini`, `openai:gpt-4o`, `anthropic:claude-3-5-haiku`, `anthropic:claude-3-5-sonnet`.

### Core domain types + logic (vendor-neutral)

- [X] T022 [P] Implement zod schemas + TS types for `NormalizedRequest`, `RequestRequirements`, `ClientOverride`, `Message`, `Capability` in [packages/core/src/types/request.ts](../../packages/core/src/types/request.ts) per [data-model.md](./data-model.md).
- [X] T023 [P] Implement zod schemas + TS types for `Model`, `PricingTable`, `PricingEntry` in [packages/core/src/types/catalog.ts](../../packages/core/src/types/catalog.ts).
- [X] T024 [P] Implement zod schemas + TS types for `RoutingDecision`, `CandidateScore`, `RationaleEntry`, `Attempt`, `ErrorClass`, `TelemetryEvent`, `TelemetryRollup` in [packages/core/src/types/telemetry.ts](../../packages/core/src/types/telemetry.ts).
- [X] T025 [P] Implement zod schemas + TS types for `OperatorRule`, `RuleMatch`, `ApiKey`, `ProviderHealthState` in [packages/core/src/types/governance.ts](../../packages/core/src/types/governance.ts).
- [X] T026 [P] Write failing unit tests in [packages/core/test/redaction.test.ts](../../packages/core/test/redaction.test.ts) covering: secret patterns (`sk-*`, bearer tokens, `api_key=*`), emails, phone numbers, credit-card digits, 512-char truncation, immutability (constitution Principle VII, FR-023).
- [X] T027 Implement redaction module in [packages/core/src/redaction/rules.ts](../../packages/core/src/redaction/rules.ts) and [packages/core/src/redaction/apply.ts](../../packages/core/src/redaction/apply.ts) with the brand-typed `RedactedTelemetryEvent` guard used by the persistence writer (per [contracts/telemetry.md](./contracts/telemetry.md#redaction-gate)); make T026 pass.
- [X] T028 [P] Write failing unit tests in [packages/core/test/cost.test.ts](../../packages/core/test/cost.test.ts) covering: pre-call estimate, post-call cost, reconciliation formula `abs(est − actual) ≤ max($0.001, 5% × actual)` including both branches of the max, currency rounding to 6 decimal places (FR-017, FR-018, FR-019a).
- [X] T029 Implement cost module in [packages/core/src/cost/estimate.ts](../../packages/core/src/cost/estimate.ts) and [packages/core/src/cost/reconcile.ts](../../packages/core/src/cost/reconcile.ts) using `decimal.js-light`; make T028 pass.

### Provider abstraction (interfaces + shared contract-test harness + Mock adapter)

- [X] T030 Implement `ProviderAdapter` interface, `ExecuteInput`, `ExecuteResult` types in [packages/providers/src/abstraction/provider.ts](../../packages/providers/src/abstraction/provider.ts) verbatim from [contracts/provider.md](./contracts/provider.md#interface-lcaprovidersabstraction).
- [X] T031 Implement the shared `providerContractTests(makeAdapter)` suite in [packages/providers/src/contract-tests/index.ts](../../packages/providers/src/contract-tests/index.ts) covering C1–C10 from [contracts/provider.md](./contracts/provider.md#contract-test-suite).
- [X] T032 Implement Mock adapter in [packages/providers/src/mock/adapter.ts](../../packages/providers/src/mock/adapter.ts) supporting `LCA_MOCK_FAIL_FIRST` env var for scripted failure injection (needed by quickstart Scenario 5).
- [X] T033 Wire Mock adapter to the shared contract suite in [packages/providers/test/mock.contract.test.ts](../../packages/providers/test/mock.contract.test.ts); the suite must pass green.
- [X] T034 [P] Implement provider registry in [packages/providers/src/registry.ts](../../packages/providers/src/registry.ts) that exposes a `Provider[]` by id and enforces uniqueness.

### Config + observability plumbing

- [X] T035 [P] Implement config loader in [packages/api/src/config.ts](../../packages/api/src/config.ts) validating env vars with zod (`DATABASE_URL`, `LCA_LOG_LEVEL`, `OTEL_EXPORTER_OTLP_ENDPOINT`, etc.).
- [X] T036 [P] Implement pino logger factory in [packages/api/src/plugins/logging.ts](../../packages/api/src/plugins/logging.ts) with the shared redaction rule set from `@lca/core/redaction` applied via `redact.paths`.
- [X] T037 [P] Implement OpenTelemetry bootstrap in [packages/api/src/plugins/tracing.ts](../../packages/api/src/plugins/tracing.ts) with OTLP exporter and correlation-id propagation via `x-request-id` header + AsyncLocalStorage.
- [X] T038 [P] Implement prom-client registry in [packages/api/src/plugins/metrics.ts](../../packages/api/src/plugins/metrics.ts) exposing `/metrics`; register base counters and histograms.
- [X] T039 [P] Implement structured error mapper in [packages/api/src/plugins/errors.ts](../../packages/api/src/plugins/errors.ts) mapping thrown errors to the OpenAPI `ErrorResponse` shape (`{ code, message, details }`).

### API-key auth (needed by every non-health route)

- [X] T040 [P] Write failing unit tests in [packages/persistence/test/auth.test.ts](../../packages/persistence/test/auth.test.ts) covering: create key (Argon2id hash), verify key (constant-time), revoke key, list keys metadata-only (no `hashedSecret` leaked).
- [X] T041 Implement API-key store in [packages/persistence/src/auth/keys.ts](../../packages/persistence/src/auth/keys.ts) using `@node-rs/argon2`; make T040 pass.
- [X] T042 Implement Fastify auth plugin in [packages/api/src/plugins/auth.ts](../../packages/api/src/plugins/auth.ts) reading `Authorization: Bearer <token>`, verifying via the key store, and attaching `clientId` to the request context.

### Minimal server + health

- [X] T043 Implement Fastify server factory in [packages/api/src/server.ts](../../packages/api/src/server.ts) that registers logging, tracing, metrics, errors, auth, and error-mapper plugins.
- [X] T044 Implement `/v1/health` route in [packages/api/src/routes/health.ts](../../packages/api/src/routes/health.ts) (unauthenticated) with checks for DB reachability and active pricing table presence.
- [X] T045 [P] Write Fastify bootstrap script at [packages/api/src/index.ts](../../packages/api/src/index.ts) wiring `server.ts`, listening on `PORT` (default 8080), refusing boot when no active pricing table exists.

**Checkpoint**: Migration + seed run cleanly; `GET /v1/health` returns 200 with an active pricing table; provider contract-test harness passes for Mock; auth plugin verified. **User-story implementation can now begin.**

---

## Phase 3: User Story 1 — Cost-aware routed request across multiple providers (Priority: P1) 🎯 MVP

**Goal**: A client sends a chat/completion request to the autopilot; the autopilot picks the best-fit model from a multi-provider catalog using a deterministic scoring function and returns a normalized response, with a machine-readable rationale.

**Independent Test**: Two providers configured (`mock-fast`, `mock-cheap`) each exposing different price/latency/quality metadata; requests are routed to the deterministically predicted model, response shape is uniform, running the same request twice yields the same decision. Quickstart Scenario 1 covers this end-to-end.

### Tests for User Story 1 (write first, MUST fail) ⚠️

- [X] T046 [P] [US1] Contract test for `POST /v1/completions` in [packages/api/test/routes/completions.contract.test.ts](../../packages/api/test/routes/completions.contract.test.ts) using the schemas from [contracts/http-api.yaml](./contracts/http-api.yaml) (200 success shape, 401 no-auth, 422 context exceeded, 422 override missing).
- [X] T047 [P] [US1] Contract test for `POST /v1/routing/preview` in [packages/api/test/routes/preview.contract.test.ts](../../packages/api/test/routes/preview.contract.test.ts) asserting no provider call is made and no telemetry is written.
- [X] T048 [P] [US1] Contract test for `GET /v1/catalog` in [packages/api/test/routes/catalog.contract.test.ts](../../packages/api/test/routes/catalog.contract.test.ts).
- [X] T049 [P] [US1] Integration test for US1 acceptance scenarios in [packages/api/test/integration/us1-routing.test.ts](../../packages/api/test/integration/us1-routing.test.ts): lowest-cost pick when no requirements, latency ceiling excludes a candidate, capability-required forces provider, determinism (same request twice), context-exceeded rejection.
- [X] T050 [P] [US1] Unit tests for deterministic scoring in [packages/core/test/routing.test.ts](../../packages/core/test/routing.test.ts) covering all factors listed in FR-010, plus tiebreaker rules from FR-031.
- [X] T051 [P] [US1] Unit tests for evaluation pipeline in [packages/core/test/evaluation.test.ts](../../packages/core/test/evaluation.test.ts): capability filter, context-window filter, latency ceiling filter, token estimation with tiktoken.

### Implementation for User Story 1

- [X] T052 [US1] Implement evaluation pipeline (capability filter, context filter, latency filter, token estimator using `@dqbd/tiktoken`) in [packages/core/src/evaluation/evaluate.ts](../../packages/core/src/evaluation/evaluate.ts); make T051 pass.
- [X] T053 [US1] Implement deterministic scoring function + tiebreakers + rationale builder in [packages/core/src/routing/score.ts](../../packages/core/src/routing/score.ts) and [packages/core/src/routing/decide.ts](../../packages/core/src/routing/decide.ts); make T050 pass. Depends on T024, T029, T052.
- [X] T054 [P] [US1] Implement OpenAI adapter in [packages/providers/src/openai/adapter.ts](../../packages/providers/src/openai/adapter.ts) — the only file allowed to `import "openai"`.
- [X] T055 [P] [US1] Implement Anthropic adapter in [packages/providers/src/anthropic/adapter.ts](../../packages/providers/src/anthropic/adapter.ts) — the only file allowed to `import "@anthropic-ai/sdk"`.
- [X] T056 [P] [US1] Wire OpenAI adapter to shared contract suite in [packages/providers/test/openai.contract.test.ts](../../packages/providers/test/openai.contract.test.ts) using recorded fixtures (no live calls in CI unless `RUN_LIVE_PROVIDER_TESTS=1`).
- [X] T057 [P] [US1] Wire Anthropic adapter to shared contract suite in [packages/providers/test/anthropic.contract.test.ts](../../packages/providers/test/anthropic.contract.test.ts) using recorded fixtures.
- [X] T058 [US1] Implement catalog loader in [packages/persistence/src/catalog/load.ts](../../packages/persistence/src/catalog/load.ts) that merges each registered adapter's `listModels()` with the active pricing table entries and rejects models with no matching pricing entry (Principle V).
- [X] T059 [US1] Implement provider-health probe scheduler in [packages/persistence/src/health/probe.ts](../../packages/persistence/src/health/probe.ts): 30s interval, updates `provider_health_state`, uses the state-transition rules from [data-model.md](./data-model.md#state-transitions) (3 consecutive fails → unhealthy).
- [X] T060 [US1] Implement `POST /v1/completions` route in [packages/api/src/routes/completions.ts](../../packages/api/src/routes/completions.ts): normalize → evaluate → decide → execute via chosen adapter → return normalized response. Uses DI wiring from [packages/api/src/wiring.ts](../../packages/api/src/wiring.ts). Make T046 and T049 pass (subset).
- [X] T061 [US1] Implement `POST /v1/routing/preview` route in [packages/api/src/routes/preview.ts](../../packages/api/src/routes/preview.ts): returns the RoutingDecision only; no provider call, no telemetry write. Make T047 pass.
- [X] T062 [US1] Implement `GET /v1/catalog` route in [packages/api/src/routes/catalog.ts](../../packages/api/src/routes/catalog.ts). Make T048 pass.
- [X] T063 [P] [US1] Implement CLI commands `lca complete`, `lca route preview`, `lca catalog list` in [packages/cli/src/commands/complete.ts](../../packages/cli/src/commands/complete.ts), [packages/cli/src/commands/route.ts](../../packages/cli/src/commands/route.ts), [packages/cli/src/commands/catalog.ts](../../packages/cli/src/commands/catalog.ts). Support `--json`, `--api-url`, `--api-key` per [contracts/cli.md](./contracts/cli.md).
- [X] T064 [P] [US1] CLI-integration test in [packages/cli/test/us1.test.ts](../../packages/cli/test/us1.test.ts) exercising `lca complete` and `lca route preview` against an in-process API.

**Checkpoint**: Quickstart Scenario 1 (and its determinism assertion) passes. MVP is demoable. SC-004, SC-010, and the deterministic parts of SC-007 are validated for the routing path.

---

## Phase 4: User Story 2 — Auditable telemetry and versioned cost accounting (Priority: P2)

**Goal**: Every request handled by the autopilot produces a durable telemetry record with the routing rationale, versioned pricing pointer, and reconciliation flag; operators can query events, aggregated rollups, and replay past decisions.

**Independent Test**: Execute a batch of requests, verify each event contains every required field, that pricing-table version IDs change when the active pricing table is switched between requests, and that `POST /v1/telemetry/replay/{id}` reproduces the routing decision exactly. Quickstart Scenario 2 + 6 cover this.

### Tests for User Story 2 (write first, MUST fail) ⚠️

- [X] T065 [P] [US2] Contract test for `GET /v1/telemetry/events` in [packages/api/test/routes/telemetry-events.contract.test.ts](../../packages/api/test/routes/telemetry-events.contract.test.ts).
- [X] T066 [P] [US2] Contract test for `GET /v1/telemetry/rollups` in [packages/api/test/routes/telemetry-rollups.contract.test.ts](../../packages/api/test/routes/telemetry-rollups.contract.test.ts).
- [X] T067 [P] [US2] Contract test for `GET /v1/telemetry/replay/{eventId}` in [packages/api/test/routes/telemetry-replay.contract.test.ts](../../packages/api/test/routes/telemetry-replay.contract.test.ts).
- [X] T068 [P] [US2] Telemetry contract tests T1–T7 from [contracts/telemetry.md](./contracts/telemetry.md#contract-test-assertions) in [packages/persistence/test/telemetry.contract.test.ts](../../packages/persistence/test/telemetry.contract.test.ts): writer refuses non-redacted input, round-trip, aggregation formula, deletion preserves rollups, replay reproduces decision, reconciliation formula on both branches, secret fuzz (1 000 payloads).
- [X] T069 [P] [US2] Integration test in [packages/api/test/integration/us2-telemetry.test.ts](../../packages/api/test/integration/us2-telemetry.test.ts) covering US2 acceptance scenarios: telemetry contains all fields, pricing versions differ across requests, replay matches, failure telemetry has partial cost, no unredacted PII.

### Implementation for User Story 2

- [X] T070 [US2] Implement telemetry writer with the `RedactedTelemetryEvent` brand gate in [packages/persistence/src/telemetry/write.ts](../../packages/persistence/src/telemetry/write.ts) — refuses non-branded input, batches inserts (buffer window ≤ 200 ms or 100 rows). Make relevant parts of T068 pass.
- [X] T071 [P] [US2] Implement fallback-aware attempt-chain builder in [packages/core/src/telemetry/build-event.ts](../../packages/core/src/telemetry/build-event.ts) that assembles a `TelemetryEvent` from a `RoutingDecision` + `Attempt[]` respecting invariants in [contracts/telemetry.md](./contracts/telemetry.md).
- [X] T072 [US2] Implement rollup aggregator in [packages/persistence/src/telemetry/rollup.ts](../../packages/persistence/src/telemetry/rollup.ts) — pure SQL implementation of the derivation formulas in [contracts/telemetry.md](./contracts/telemetry.md#rollup-field-derivations); idempotent; uses `pg_try_advisory_lock`.
- [X] T073 [US2] Implement retention scheduler in [packages/persistence/src/telemetry/retention.ts](../../packages/persistence/src/telemetry/retention.ts) — runs every 15 min under advisory lock, aggregates expiring events then deletes them, and daily deletes rollups > 12 months. Registered as an in-process job in [packages/api/src/wiring.ts](../../packages/api/src/wiring.ts).
- [X] T074 [US2] Implement telemetry query API in [packages/persistence/src/telemetry/query.ts](../../packages/persistence/src/telemetry/query.ts): cursor pagination, filters on `clientId`, `providerId`, `modelId`, `since`, `until`.
- [X] T075 [US2] Wire `POST /v1/completions` to write telemetry via T070 and T071 (attempts chain, reconciliation flag, pricing version). Update [packages/api/src/routes/completions.ts](../../packages/api/src/routes/completions.ts). Make US1 integration test still green.
- [X] T076 [US2] Implement `GET /v1/telemetry/events` route in [packages/api/src/routes/telemetry-events.ts](../../packages/api/src/routes/telemetry-events.ts). Make T065 pass.
- [X] T077 [US2] Implement `GET /v1/telemetry/rollups` route in [packages/api/src/routes/telemetry-rollups.ts](../../packages/api/src/routes/telemetry-rollups.ts). Make T066 pass.
- [X] T078 [US2] Implement `GET /v1/telemetry/replay/{eventId}` route in [packages/api/src/routes/telemetry-replay.ts](../../packages/api/src/routes/telemetry-replay.ts) — re-runs the deterministic scorer against the stored inputs and returns `{ recorded, replayed, matches }`. Make T067 and the replay part of T068 pass.
- [X] T079 [P] [US2] Add `lca_reconciliation_rate` (gauge) and `lca_reconciliation_alert_active` (gauge, 0/1) to [packages/api/src/plugins/metrics.ts](../../packages/api/src/plugins/metrics.ts). The gauge and alert MUST use the FR-019a rolling window: trailing 60 minutes OR the 1,000 most-recent reconcilable requests, whichever bound is reached first. Alert clears once the rate returns to ≥ 95% for one full window.
- [X] T080 [P] [US2] Implement CLI commands `lca telemetry query`, `lca telemetry rollups`, `lca telemetry replay <id>` in [packages/cli/src/commands/telemetry.ts](../../packages/cli/src/commands/telemetry.ts). `replay` exits non-zero on divergence per [contracts/cli.md](./contracts/cli.md).

**Checkpoint**: Quickstart Scenarios 2 and 6 pass. SC-001, SC-002, SC-003, and SC-008 are validated on the Mock-provider fixture.

---

## Phase 5: User Story 3 — Client and operator overrides of autonomous routing (Priority: P3)

**Goal**: Clients can pin provider/model on a per-request basis; operators can define server-side rules that pin routing for matching requests. Operator rules take precedence over client overrides (Clarification Q1). Every telemetry record identifies the effective source and any shadowed source.

**Independent Test**: Submit two functionally identical requests — one with a client override for provider B, one without. Verify the overridden request uses provider B, the non-overridden one uses autopilot scoring, and telemetry records the correct `decision_source` on each. Add an operator rule and verify it shadows the client override. Quickstart Scenarios 3 and 4 cover this.

### Tests for User Story 3 (write first, MUST fail) ⚠️

- [X] T081 [P] [US3] Contract tests for `GET|POST /v1/operator/rules` and `PATCH|DELETE /v1/operator/rules/{ruleId}` in [packages/api/test/routes/rules.contract.test.ts](../../packages/api/test/routes/rules.contract.test.ts).
- [X] T082 [P] [US3] Contract tests for `GET|POST /v1/keys` and `DELETE /v1/keys/{keyId}` in [packages/api/test/routes/keys.contract.test.ts](../../packages/api/test/routes/keys.contract.test.ts); assert secret is returned only on create and never re-appears in any subsequent response.
- [X] T083 [P] [US3] Integration test for US3 acceptance scenarios in [packages/api/test/integration/us3-overrides.test.ts](../../packages/api/test/integration/us3-overrides.test.ts): client override honored, invalid override rejected (422, no provider call), operator rule shadows client override, telemetry records effective + shadowed sources, override rationale explains that autonomous scoring was bypassed.
- [X] T084 [P] [US3] Unit tests for override precedence resolver in [packages/core/test/overrides.test.ts](../../packages/core/test/overrides.test.ts) covering FR-027: operator > client > autopilot; empty overrides fall through; client override survives when no operator rule matches; both sources recorded on shadow.
- [X] T085 [P] [US3] Unit tests for operator-rule matcher in [packages/core/test/rule-match.test.ts](../../packages/core/test/rule-match.test.ts) covering every field of `RuleMatch` (client IDs, capabilities, token ranges).

### Implementation for User Story 3

- [X] T086 [US3] Implement operator-rule matcher in [packages/core/src/overrides/match.ts](../../packages/core/src/overrides/match.ts). Make T085 pass.
- [X] T087 [US3] Implement override precedence resolver in [packages/core/src/overrides/resolve.ts](../../packages/core/src/overrides/resolve.ts) that returns `{ effectiveSource, shadowedSource, pin }`. Make T084 pass.
- [X] T088 [US3] Implement operator-rule store + in-process cache with invalidation channel in [packages/persistence/src/overrides/store.ts](../../packages/persistence/src/overrides/store.ts).
- [X] T089 [US3] Wire override resolution into `POST /v1/completions` in [packages/api/src/routes/completions.ts](../../packages/api/src/routes/completions.ts): resolve overrides → force pin into routing decision → mark `decision_source` and `shadowed_source` on the resulting telemetry event. Reject invalid override targets with 422 `override_target_missing` (FR-028); do not attempt any provider call. Update US1/US2 tests remain green.
- [X] T090 [US3] Implement operator-rules CRUD routes in [packages/api/src/routes/rules.ts](../../packages/api/src/routes/rules.ts). Make T081 pass.
- [X] T091 [US3] Implement API-key management routes in [packages/api/src/routes/keys.ts](../../packages/api/src/routes/keys.ts). Make T082 pass. Only `POST /v1/keys` ever includes the plaintext secret in a response.
- [X] T092 [P] [US3] Implement CLI commands `lca rules list|add|update|delete` in [packages/cli/src/commands/rules.ts](../../packages/cli/src/commands/rules.ts) and `lca keys list|create|revoke` in [packages/cli/src/commands/keys.ts](../../packages/cli/src/commands/keys.ts).

**Checkpoint**: Quickstart Scenarios 3 and 4 pass. SC-006 is validated. FR-027 precedence and FR-028 rejection are enforced end-to-end.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finish enforcing constitution-level requirements (CLI+API parity, performance budgets, redaction, security posture), validate the full quickstart, and prepare release automation.

### Fallback + reliability

- [ ] T093 [P] Write unit tests for the fallback contract in [packages/core/test/fallback.test.ts](../../packages/core/test/fallback.test.ts) covering FR-033/FR-034/FR-035 — transient errors trigger exactly one fallback, non-transient errors do not, override targets do not fallback, chain never exceeds length 2, terminal error class is set correctly.
- [ ] T094 Implement fallback executor in [packages/core/src/routing/execute-with-fallback.ts](../../packages/core/src/routing/execute-with-fallback.ts); wire into [packages/api/src/routes/completions.ts](../../packages/api/src/routes/completions.ts). Make T093 pass and re-run Quickstart Scenario 5.
- [ ] T095 [P] Integration test for fallback in [packages/api/test/integration/fallback.test.ts](../../packages/api/test/integration/fallback.test.ts) with `LCA_MOCK_FAIL_FIRST=upstream_5xx` — both attempts recorded, terminal outcome `none`.

### CLI + API parity (Principle II)

- [ ] T096 Implement the CLI↔OpenAPI parity contract test in [packages/api/test/contract/parity.test.ts](../../packages/api/test/contract/parity.test.ts) per [contracts/cli.md](./contracts/cli.md#parity-rules-asserted-by-contract-test): every documented HTTP path maps to a CLI command node, every CLI argument maps to an OpenAPI field, every command supports `--json` unless it produces no output.

### Performance (Principle X, SC-007, SC-011)

- [ ] T097 [P] Implement routing-overhead bench in [packages/core/bench/overhead.bench.ts](../../packages/core/bench/overhead.bench.ts) using `vitest bench`: asserts p50 ≤ 20 ms, p95 ≤ 75 ms on the routing pipeline against a fixed catalog.
- [ ] T098 [P] Implement throughput bench in [packages/api/bench/throughput.mjs](../../packages/api/bench/throughput.mjs) using `autocannon`: 60 s @ 100 rps sustained then 60 s @ 500 rps burst against Mock provider; asserts zero telemetry write failures and RSS growth ≤ 100 MB.
- [ ] T099 Wire `npm run bench:overhead` and `npm run bench:throughput` to CI as a request-path smoke stage in [.github/workflows/ci.yml](../../.github/workflows/ci.yml); gate merge on regressions.

### Security + redaction (Principle VII, SC-009)

- [ ] T100 [P] Fuzz test for redaction in [packages/core/test/redaction.fuzz.test.ts](../../packages/core/test/redaction.fuzz.test.ts) generating 1 000 secret-shaped payloads (`sk-*`, bearers, emails, phones, cards) embedded in messages; asserts none appear in the persisted `TelemetryEvent`.
- [ ] T101 [P] End-to-end secret-leak audit script in [scripts/audit-secrets.mjs](../../scripts/audit-secrets.mjs) that runs the test suite with a known API-key value and then greps the full test-run output (`stdout`, `stderr`, DB dump) for that value; MUST exit 0 with zero matches. Wire to CI.
- [ ] T102 Enforce `no-restricted-imports` for vendor SDKs and confirm ESLint fails on any core/persistence/api file importing `openai` or `@anthropic-ai/sdk` (Principle VI); commit a fixture test in [packages/core/test/no-vendor-imports.test.ts](../../packages/core/test/no-vendor-imports.test.ts).

### Provider scaffold + adapter add-only guarantee (SC-005)

- [ ] T103 [P] Implement provider scaffolder script at [scripts/scaffold-provider.mjs](../../scripts/scaffold-provider.mjs) referenced by Quickstart Scenario 8: creates `packages/providers/src/<name>/`, generates a contract-test stub, and registers the adapter.
- [ ] T104 [P] CI guard in [.github/workflows/ci.yml](../../.github/workflows/ci.yml) that flags PRs which touch both `packages/providers/**` and `packages/core/**` and requires an override label (per [contracts/provider.md](./contracts/provider.md#adding-a-new-provider)).

### Documentation

- [ ] T105 [P] Rewrite [README.md](../../README.md) with the product statement, quickstart pointer, and architecture summary from [plan.md](./plan.md).
- [ ] T106 [P] Add [docs/operations.md](../../docs/operations.md) covering: enabling providers, adding operator rules, rotating API keys, tracing/metric endpoints, retention behavior.

### Additional coverage from /speckit-analyze

- [X] T0109 [P] [US2] Integration test asserting correlation-ID round-trip in [packages/api/test/integration/correlation-id.test.ts](../../packages/api/test/integration/correlation-id.test.ts): submit a request with a client-supplied `x-request-id` header and verify (a) the same value is echoed on the HTTP response header, (b) `TelemetryEvent.eventId` equals that value, and (c) OpenTelemetry span attributes on the request span carry it (FR-021).
- [ ] T110 [P] [US1] Integration test asserting unhealthy providers are excluded from routing candidates in [packages/api/test/integration/unhealthy-exclusion.test.ts](../../packages/api/test/integration/unhealthy-exclusion.test.ts): mark one adapter unhealthy in `provider_health_state`, submit a request, assert none of its models appear in `decision.candidateRanking[].included = true` and it is not the `chosenModelId` (FR-029).
- [ ] T111 [P] [US1] Integration test asserting the all-unhealthy edge case in [packages/api/test/integration/all-unhealthy.test.ts](../../packages/api/test/integration/all-unhealthy.test.ts): mark every configured adapter unhealthy, submit a request, expect a structured error response with `error.code === "provider_unavailable"` and no provider call attempted (spec Edge Cases; FR-029, FR-035).

### Final validation

- [ ] T107 Run every scenario in [quickstart.md](./quickstart.md) end-to-end from a clean checkout and record results in [docs/qa/quickstart-2026-09-08.md](../../docs/qa/quickstart-2026-09-08.md); block release on any failure.
- [ ] T108 Verify constitution compliance final pass against every principle using the review checklist in [plan.md](./plan.md#post-design-constitution-re-check); attach output to the release PR.

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup)** — no dependencies.
- **Phase 2 (Foundational)** — depends on Setup; blocks Phases 3–6.
- **Phase 3 (US1)** — depends on Foundational. Delivers the MVP.
- **Phase 4 (US2)** — depends on Foundational; may run in parallel with Phase 3 for the parts that don't touch `POST /v1/completions` (T070–T074, T076–T080). T075 (wiring telemetry into the completions route) depends on T060 from Phase 3.
- **Phase 5 (US3)** — depends on Foundational; T089 (wiring overrides into completions) depends on T060 from Phase 3 and on T075 from Phase 4.
- **Phase 6 (Polish)** — depends on all desired user stories being complete.

### Story dependencies (summary)

- **US1** — independent given Foundational.
- **US2** — independent given Foundational; integrates with US1 only via T075.
- **US3** — independent given Foundational; integrates with US1 via T089 and with US2 via telemetry `decision_source`/`shadowed_source` fields.

### Within each user story

- Tests (contract + integration + unit) are written first and MUST fail before implementation begins (Principle III).
- Core library tasks come before adapter/route tasks.
- Adapter/route tasks come before CLI tasks.
- Do not move to the next user story until the current one's checkpoint passes.

### Parallel opportunities

- **Setup**: T003–T006 in parallel; T007 vs T008/T009/T010/T011 in parallel; T012–T016 in parallel.
- **Foundational**:
  - Domain-type tasks T022–T025 fully parallel.
  - T026 and T028 (test-writing) parallel with T022–T025.
  - Observability plumbing T035–T039 fully parallel with core work.
- **US1**: All test tasks T046–T051 in parallel. Adapter tasks T054 and T055 parallel (different files). Contract-suite hookups T056 and T057 parallel. CLI task T063 parallel with API tasks once route interfaces stabilize.
- **US2**: Test tasks T065–T069 in parallel. Metrics (T079) and CLI (T080) parallel with route implementations. T109 depends on T037 (tracing plugin) + T075 (telemetry wired into completions).
- **US3**: Test tasks T081–T085 in parallel. CLI (T092) parallel with route work.
- **Polish**: T097, T098, T100, T101, T103, T104, T105, T106 all parallelizable.

---

## Parallel Example: User Story 1 kickoff

```bash
# Write all failing tests first (Test-First; NON-NEGOTIABLE).
Task: "Contract test POST /v1/completions in packages/api/test/routes/completions.contract.test.ts"     # T046
Task: "Contract test POST /v1/routing/preview in packages/api/test/routes/preview.contract.test.ts"     # T047
Task: "Contract test GET /v1/catalog in packages/api/test/routes/catalog.contract.test.ts"              # T048
Task: "Integration test for US1 acceptance scenarios in packages/api/test/integration/us1-routing.test.ts"  # T049
Task: "Unit tests for deterministic scoring in packages/core/test/routing.test.ts"                       # T050
Task: "Unit tests for evaluation pipeline in packages/core/test/evaluation.test.ts"                      # T051

# Then implementations that can proceed in parallel:
Task: "OpenAI adapter in packages/providers/src/openai/adapter.ts"                                       # T054
Task: "Anthropic adapter in packages/providers/src/anthropic/adapter.ts"                                 # T055
```

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Complete Phase 1 (Setup).
2. Complete Phase 2 (Foundational) — CRITICAL, blocks everything.
3. Complete Phase 3 (US1).
4. **STOP and VALIDATE**: run Quickstart Scenario 1; confirm determinism and multi-provider routing on Mock adapters.
5. Deploy or demo the MVP.

### Incremental delivery

1. Setup + Foundational → foundation ready.
2. US1 → validate → **MVP**.
3. US2 → validate → telemetry-audit release.
4. US3 → validate → governance-ready release.
5. Polish → performance-verified release.

### Parallel team strategy

Once Foundational completes, three developers can proceed:

- Dev A → US1 (P1)
- Dev B → US2 (P2) — start telemetry writer, rollup aggregator, retention scheduler; integrate with US1 via T075 when the completions route lands.
- Dev C → US3 (P3) — start override resolver, rule matcher, rules CRUD; integrate via T089 last.

Fallback executor (T093–T095) sits in Phase 6 because its behavior spans US1 and US2 (needs both the routing chain and telemetry attempts recorded). If schedule permits, promote T093–T094 into US1 to close the reliability contract earlier.

---

## Notes

- `[P]` tasks touch different files with no unresolved dependencies.
- `[Story]` labels tie tasks to spec user stories for traceability (see [spec.md](./spec.md#user-scenarios--testing-mandatory)).
- Every implementation task references at least one concrete file path.
- Verify tests fail before implementing — Principle III is non-negotiable.
- Commit after each task or logical group.
- Stop at each checkpoint to validate the story independently.
- Do NOT modify `packages/core/**` in a PR that adds a provider; CI (T104) enforces this.
