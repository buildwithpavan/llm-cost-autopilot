# Phase 0 Research: LLM Cost Autopilot MVP

**Feature**: [001-llm-routing-mvp](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-09-08

The spec ([spec.md](./spec.md)) intentionally left concrete stack choices to the planning phase (see the last Assumption line). This document records each decision, the rationale tied back to spec + constitution requirements, and the alternatives rejected. No `NEEDS CLARIFICATION` markers remain after this phase.

## HTTP framework

**Decision**: Fastify 5.

**Rationale**:

- The constitution mandates Node.js 22 + TypeScript strict (Additional Constraints) and requires the framework to sit behind a thin-shell boundary so the routing library remains independent of it (Principle I).
- Fastify has first-class TypeScript typings, schema-based request validation (zod-compatible via `fastify-type-provider-zod`), a plugin system that fits the "thin shell" model, and per-request logger context via pino out of the box.
- Benchmarked throughput comfortably clears the 100 rps sustained / 500 rps burst target (SC-011) on a single Node process.
- Ecosystem: `@fastify/otel`, `@fastify/rate-limit`, `@fastify/helmet` cover observability + security needs without custom middleware.

**Alternatives considered**:

- **Hono** — attractive DX and edge-runtime support, but weaker Node-side observability integrations (no first-class pino binding) and smaller Node-in-production track record for the specific "gateway" use case.
- **Express 5** — mature but weaker TypeScript ergonomics, no built-in schema validation, and pino/OpenTelemetry integration requires more glue.
- **NestJS** — too heavy for the "thin composition shell" required by Principle I; introduces DI framework and decorator patterns that pull domain logic out of `@lca/core`.

## Database access

**Decision**: `pg` (node-postgres) with **Kysely** as a typed query builder. Migrations via **node-pg-migrate**.

**Rationale**:

- Constitution requires PostgreSQL as the primary store. Kysely gives compile-time-checked SQL without a heavy ORM runtime, matching Principle VIII (Simplicity).
- Kysely lets the telemetry writer emit multi-row INSERTs with strong types, important for the buffered/batched insert pattern chosen for the 100 rps target.
- `node-pg-migrate` supports plain-SQL migrations and TypeScript migration files; both are checked into `db/migrations/`.

**Alternatives considered**:

- **Drizzle** — also strong; slightly more magical schema DSL and a rapidly-changing migration model. Kysely's SQL-native surface won on transparency for a cost-critical audit path.
- **Prisma** — heavy runtime, generated client makes per-package boundaries painful in a monorepo, and its connection model conflicts with our multi-adapter DI. Rejected.
- **Raw `pg` only** — type-safety loss unacceptable given TS `strict` and Test-First requirements.

## Test framework

**Decision**: Vitest for unit + contract + integration; supertest for HTTP integration.

**Rationale**:

- ESM-native, TypeScript-first, extremely fast — matches the Test-First cadence Principle III demands.
- Built-in `bench` mode covers the per-PR performance-budget gate (Principle X, SC-007).
- Contract tests for provider adapters are just a shared Vitest suite exported from `@lca/providers/contract-tests`.

**Alternatives considered**:

- **Node's built-in `node:test`** — good and shipping, but lacks the mock/spy DX and benchmark story needed for the perf gate.
- **Jest** — historical baggage, slower on TS ESM, unnecessary Babel layer.

## Observability stack

**Decision**: pino for logs, prom-client for metrics, `@opentelemetry/sdk-node` with OTLP exporter for traces. Correlation ID propagated via `x-request-id` header + AsyncLocalStorage.

**Rationale**:

- Principle IV requires structured JSON logs, metrics, and distributed tracing with correlation-id propagation. This stack is the canonical Node.js implementation of that requirement.
- pino integrates natively with Fastify (`fastify.log`), enforces JSON output, and supports redaction paths (`redact` option) as a defense-in-depth for Principle VII.
- OpenTelemetry is vendor-neutral, so backend choice (Jaeger, Tempo, Honeycomb, etc.) becomes a deployment concern, not a code change.

**Alternatives considered**:

- **Winston** — string-first logger, weaker perf, worse structured-log ergonomics.
- **DataDog/NewRelic proprietary SDKs** — vendor lock-in violates the platform's own product ethos.

## Token estimation

**Decision**: `@dqbd/tiktoken` for pre-call estimates; provider-reported usage counts used for post-call actuals.

**Rationale**:

- Deterministic BPE tokenization for OpenAI-family models, needed for the pre-call cost estimate (FR-017) and the reconciliation formula (FR-019a). For Anthropic, use its SDK's `countTokens` API when available; fall back to a documented heuristic (chars ÷ 3.5) and mark the estimate as `heuristic` in telemetry.
- Actual token counts always come from the provider response when returned, avoiding double-source-of-truth errors.

**Alternatives considered**:

- **gpt-tokenizer** — pure-JS, no native binding, slightly slower but simpler ship. Recorded as a fallback if `@dqbd/tiktoken` proves problematic on the target Docker image.
- **Rolling our own** — rejected on Principle VIII.

## Decimal / currency arithmetic

**Decision**: `decimal.js-light` throughout `@lca/core/cost`. Internal representation is USD stored to 6 decimal places (microcents-of-a-dollar); formatting for humans happens at CLI/API boundary only.

**Rationale**:

- Native JS numbers cannot represent typical LLM per-token prices ($0.0000015) without rounding drift; that drift would breach FR-019a's `$0.001` tolerance on aggregation over many small requests.
- Centralizing rounding rules (Principle V) requires one arithmetic library; `decimal.js-light` is small (< 10 kB min+gz) and has no runtime dependencies.

**Alternatives considered**:

- **big.js / decimal.js (full)** — full `decimal.js` is fine but ~4× larger; `decimal.js-light` covers the operations we need.
- **BigInt in microcents** — workable, but the ergonomics of division/percentage in FR-019a make Decimal safer.

## Configuration + validation

**Decision**: zod for all external inputs (HTTP request bodies, CLI args, env config, pricing-table files, operator rule files).

**Rationale**:

- One schema library across API and CLI keeps contracts symmetric and validation errors uniform, supporting Principle II (CLI + API parity).
- zod schemas double as the runtime source of truth used by `fastify-type-provider-zod` to publish the OpenAPI contract in `contracts/http-api.yaml`.

**Alternatives considered**:

- **valibot** — smaller runtime, newer; less mature Fastify integration today.
- **ajv + JSON schema** — more ceremony, weaker TS inference.

## CLI framework

**Decision**: `commander`.

**Rationale**:

- Mature, small, ubiquitous, and its argument-parsing surface is stable enough to lock into the CLI contract in `contracts/cli.md`.
- Supports subcommands and JSON output flags cleanly — needed for Principle II's "JSON on stdout, human-readable on stderr behind a flag" clause.

**Alternatives considered**:

- **yargs** — larger API surface, more historical churn.
- **citty** / **oclif** — either overkill or introduces a plugin abstraction we do not need for MVP.

## Authentication (client → autopilot)

**Decision**: Opaque bearer tokens ("API keys"). Keys are generated by the platform, hashed with **Argon2id** using `@node-rs/argon2`, and stored in the `api_keys` table with owner metadata (label, created_at, last_used_at, revoked_at). Clients present `Authorization: Bearer <token>`. Verification is constant-time.

**Rationale**:

- FR-037 requires authentication by default. Bearer tokens are the industry standard for service-to-service and machine-to-service auth; no interactive login flow is needed for MVP scope.
- Hashed storage prevents leak-via-database from disclosing usable keys. Argon2id resists brute force even under database compromise.
- A migration to OIDC/JWT for human consoles is a follow-up feature; the current design does not preclude it.

**Alternatives considered**:

- **HMAC-signed requests** — stronger, but higher client integration friction for MVP.
- **JWT (self-signed)** — introduces key-rotation complexity without a use case for the MVP.
- **mTLS** — appropriate for enterprise deployments; deferred until a customer requests it.

## Redaction policy (secrets + PII)

**Decision**: Two-stage redaction. Stage 1 (pino `redact` paths + a request-body preprocessor) strips known secret-shaped substrings (`sk-*`, `Bearer *`, `api_key=*`, email addresses, phone numbers, bare credit-card-shaped digits) from anything about to be logged. Stage 2 (telemetry writer) applies the same policy plus a truncation guard (max 512 chars of any user-supplied string) before writing to `telemetry_events`. Both stages share the same rule set in `@lca/core/redaction/rules.ts`.

**Rationale**:

- Principle VII and FR-023/FR-023a require no unredacted secrets or PII in any persisted artifact.
- One shared rule set prevents divergence between logs and telemetry — a real risk in observability stacks.

**Alternatives considered**:

- Vendor DLP services — out of scope for MVP; introduces a hard external dependency on the hot path.
- Encrypt-at-rest only — insufficient; the constitution requires no secrets in stored records at all, not merely encrypted-at-rest.

## Provider adapter contract

**Decision**: A single TypeScript interface `Provider` in `@lca/providers/abstraction`, plus a `ProviderContractTests(makeProvider)` suite exported from `@lca/providers/contract-tests`. Every adapter (mock, openai, anthropic) imports the suite and runs it in its own test file. The interface is documented in [contracts/provider.md](./contracts/provider.md).

**Rationale**:

- FR-005/FR-006/FR-007/FR-008 require a vendor-neutral abstraction and pluggable adapters.
- A shared contract test is the mechanism that makes "adding a provider = only implement the adapter" (SC-005) enforceable.

**Alternatives considered**:

- Multiple interfaces per capability (chat, tool use, streaming) — postponed. Streaming is out of scope for MVP (spec Assumptions). Introducing capability sub-interfaces before we ship the first two adapters violates Principle VIII.

## Migrations & seed data

**Decision**: `db/migrations/` holds `node-pg-migrate` files. A seed script in `packages/persistence/src/db/seed.ts` loads a starter `pricing_tables` snapshot (dated, versioned) from `db/seeds/pricing/2026-09-08.json`, and creates one Mock provider entry in `provider_health_state`. The API refuses to boot if no `pricing_tables` version is marked `active`.

**Rationale**:

- Principle V requires versioned pricing as data. Shipping a real pricing snapshot as a seed lets contract tests and quickstart run deterministically.
- Refusing to boot without an active pricing version prevents accidental silent-zero cost telemetry.

## Retention & rollups

**Decision**: One in-process scheduler in `@lca/persistence/telemetry/retention` runs every 15 minutes. Two jobs, both idempotent: `aggregate_expiring_events` produces daily rollups from the events about to age out; `delete_expired_events` removes events older than 30 days. Rollups older than 12 months are deleted by a nightly job. All jobs use advisory locks (`pg_try_advisory_lock`) so multiple API instances cooperate safely.

**Rationale**:

- Clarification Q5 requires the 30-day + 12-month tiered retention. Advisory locks avoid needing a real job scheduler service for MVP (Principle VIII).
- Idempotence + safe re-run is required by FR-023a.

**Alternatives considered**:

- Dedicated worker process — deferred until Postgres or event volume grows past what an in-process scheduler can handle.
- pg-partman for automatic table partitioning — a strong future upgrade; deferred because monthly partitioning is straightforward to add via a migration without changing application code.

## Deployment shape

**Decision**: One Docker image built from a multi-stage `docker/Dockerfile`. Final stage is `gcr.io/distroless/nodejs22-debian12`. `docker/docker-compose.dev.yml` starts a Postgres 16 container and the API for local dev. Deployment target is a single container per environment sized to sustain 100 rps (SC-011).

**Rationale**:

- Constitution requires Docker for reproducible dev + deploy.
- Distroless base image reduces attack surface (Principle VII).

## CI

**Decision**: GitHub Actions workflows: `ci.yml` (install → lint → typecheck → unit + contract + integration tests → coverage report → bench smoke), `security.yml` (`npm audit --production`, gitleaks scan on all PRs), `release.yml` (on tag: build image + publish workspaces). Required checks: install, lint, typecheck, tests, audit, gitleaks.

**Rationale**: Constitution's Development Workflow & Quality Gates section requires all of these as merge-blocking.

## Deferred / explicitly out of MVP

- Streaming responses (spec Assumption)
- Multi-tenancy (spec Assumption)
- Client rate-limiting and per-tenant budget caps (spec Assumption; telemetry schema left sufficient for later)
- Async telemetry queue / worker split (Clarification Q4)
- ML-based routing (FR-013)
- OIDC/JWT auth, mTLS, session-based UI login (this document)
- Automatic pricing-page scraping (spec Assumption)
- Non-chat modalities: embeddings, images, audio (spec Assumption)
