# Implementation Plan: LLM Cost Autopilot MVP

**Branch**: `001-llm-routing-mvp` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from [`specs/001-llm-routing-mvp/spec.md`](./spec.md)

## Summary

Deliver the MVP of LLM Cost Autopilot: an intelligent orchestration layer that accepts a chat/completion request, normalizes it into a provider-neutral shape, deterministically routes it to the best-fit model/provider from a configured catalog, executes the request via a provider adapter, and returns a normalized response. Every request produces a structured, auditable telemetry record with a machine-readable routing rationale and a cost estimate that references a versioned pricing table. Operators and clients can override autonomous routing with well-defined precedence (operator > client). On transient provider failures, a single deterministic fallback attempt is made against the next candidate from the same routing decision.

The MVP is delivered as an npm workspaces monorepo (Node.js 22 + TypeScript strict). Core routing, evaluation, cost, and telemetry logic live in vendor-neutral libraries with no imports from any provider SDK. A Fastify HTTP entrypoint and a `commander`-based CLI expose parity capabilities. PostgreSQL is the primary durable store (telemetry, rollups, pricing tables, API keys). Provider adapters are pluggable and include OpenAI, Anthropic, and a Mock provider for tests and local dev. Observability is pino (structured logs) + prom-client (metrics) + OpenTelemetry SDK (traces with correlation-id propagation).

## Technical Context

**Language/Version**: TypeScript 5.6 on Node.js 22 LTS (constitution runtime pin)

**Primary Dependencies**:
- HTTP framework: **Fastify 5** (see [research.md](./research.md#http-framework))
- Query builder: **Kysely** over **pg (node-postgres)** — typed SQL, no ORM
- Migrations: **node-pg-migrate**
- Config/validation: **zod**
- CLI: **commander**
- Logging: **pino**
- Metrics: **prom-client** (Prometheus/OpenMetrics)
- Tracing: **@opentelemetry/sdk-node** with OTLP exporter
- Decimal math: **decimal.js-light** (deterministic cost arithmetic)
- Token estimation: **@dqbd/tiktoken** (BPE, OpenAI-compatible); provider-reported counts preferred when available
- Test framework: **vitest** + **supertest** (HTTP integration)
- Vendor SDKs (used only inside adapter packages): **openai**, **@anthropic-ai/sdk**

**Storage**: PostgreSQL 16 (constitution primary store). Tables: `telemetry_events`, `telemetry_rollups`, `pricing_tables`, `pricing_entries`, `api_keys`, `operator_rules`, `provider_health_state`. Retention/rollups run as an in-process scheduled job in the API service for the MVP; can graduate to a separate worker later without contract change.

**Testing**: `vitest` for unit, contract, and integration. Contract-test suite for the provider abstraction that every adapter must pass. Integration tests use a real PostgreSQL container (dockerized) plus the Mock provider. Benchmark suite (`vitest bench` + `autocannon`) validates performance budgets and the 100 rps / 500 rps burst target.

**Target Platform**: Linux server (containerized). Reference deployment is a single Docker container behind a reverse proxy talking to a PostgreSQL 16 instance. Local dev via `docker compose`.

**Project Type**: Web service + CLI + reusable libraries — delivered as an **npm workspaces monorepo** with vendor-neutral libraries at the core and thin API/CLI shells at the edge.

**Performance Goals** (from spec + constitution):
- Added routing overhead: p50 ≤ 20 ms, p95 ≤ 75 ms, p99 ≤ 150 ms (Principle X)
- Sustained throughput: 100 req/sec continuous (SC-011)
- Burst throughput: 500 req/sec absorbed for ≥ 60 s without telemetry loss (SC-011)

**Constraints**:
- No Python / FastAPI / Uvicorn / separate Python AI service (constitution stack boundary)
- No online ML inference in MVP routing (FR-013)
- Core libraries MUST NOT import any vendor SDK (Principle VI + FR-007)
- Test-First is NON-NEGOTIABLE (Principle III)
- All externally reachable endpoints require authentication by default (FR-037)
- Deterministic routing: identical inputs → identical decisions (FR-011)
- Reconciliation tolerance: `abs(est − actual) ≤ max($0.001, 5% × actual)` (FR-019a)

**Scale/Scope**:
- ~37 functional requirements, 11 success criteria, 3 prioritized user stories
- Telemetry write volume at target: ~8.6 M events/day at 100 rps
- 30-day full-fidelity retention + 12-month daily rollups keyed by (day, provider, model)
- 2 real provider adapters (OpenAI, Anthropic) + 1 Mock adapter at MVP delivery

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Initial evaluation (pre-Phase-0)

| Principle | Compliance | How the plan satisfies it |
|-----------|-----------|---------------------------|
| I. Library-First | PASS | Core routing/evaluation/cost/telemetry live in `@lca/core`; providers, persistence, API, CLI are separate workspace packages. API and CLI are thin shells over the same libraries. |
| II. CLI + API Parity | PASS | Every MVP capability (route request, dry-run routing, inspect cost, list catalog, replay decision from telemetry, apply override) is implemented in `@lca/cli` alongside its HTTP counterpart in `@lca/api`. Contract tests assert parity. |
| III. Test-First (NON-NEGOTIABLE) | PASS | Task ordering (produced by `/speckit-tasks`) sequences failing contract + unit tests before implementation. Provider adapter contract-test suite is part of `@lca/providers` and every adapter runs it. Cost calculation frozen-fixture tests included. CI enforces coverage floor on touched files. |
| IV. Observability | PASS | pino JSON logs, prom-client metrics, OpenTelemetry traces with correlation-id propagation. Telemetry table captures per-request rationale and attempts chain. Redaction runs before any persistence or log write. |
| V. Cost Accuracy | PASS | Pricing tables versioned and stored as data (`pricing_tables` + `pricing_entries` with `version_id`). Every cost value carries `pricing_table_version_id`. FR-019a reconciliation formula implemented centrally in `@lca/core/cost`. Decimal arithmetic via `decimal.js-light`. |
| VI. Provider Abstraction | PASS | `@lca/core` has zero imports from vendor SDKs; enforced by an ESLint rule + a workspace boundary test. Provider adapters live in `@lca/providers` and only they may `import 'openai'` / `'@anthropic-ai/sdk'`. Adding a provider requires only implementing the interface and passing the contract suite. |
| VII. Security & Secret Hygiene | PASS | API-key bearer auth enabled by default on all HTTP routes. Secrets sourced from env only. Redaction module applied before persistence. gitleaks + `npm audit --production` in CI blocking on high/critical. |
| VIII. Simplicity / YAGNI | PASS | No async telemetry queue in MVP (spec Q4 explicitly permits batched inserts). No feature flags service, no plugin registry beyond the provider interface itself. Rollups run inside the API process on a scheduled tick; graduating to a worker is deferred until Postgres pressure is measured. |
| IX. Semantic Versioning | PASS | Each workspace package versioned independently starting at `0.1.0`. Public contracts (HTTP schema, CLI schema, provider interface, telemetry schema, pricing-table schema) tracked in `contracts/`. Change classification rules recorded in the constitution. |
| X. Performance Budgets | PASS | Benchmark suite included in the delivery. CI runs a smoke benchmark on request-path PRs. SC-007 and SC-011 map to concrete `vitest bench` + `autocannon` scenarios in `packages/api/bench/`. |

**Result**: No violations. Complexity Tracking section is empty; will be revisited after Phase 1.

## Project Structure

### Documentation (this feature)

```text
specs/001-llm-routing-mvp/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── http-api.yaml    # OpenAPI 3.1 spec for the HTTP surface
│   ├── cli.md           # CLI command surface (mirrors http-api)
│   ├── provider.md      # Provider adapter contract (TypeScript interface + test matrix)
│   └── telemetry.md     # Telemetry event + rollup schema
├── checklists/
│   └── requirements.md  # Spec-quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
package.json                     # npm workspaces root
tsconfig.base.json               # strict mode, ES2023, moduleResolution=NodeNext
.eslintrc.cjs                    # includes no-vendor-sdk-in-core rule
docker/
├── Dockerfile                   # multi-stage; final = distroless node:22
└── docker-compose.dev.yml       # Postgres 16 + api container for local dev
db/
└── migrations/                  # node-pg-migrate SQL migrations
packages/
├── core/                        # @lca/core — vendor-neutral logic
│   ├── src/
│   │   ├── types/               # NormalizedRequest, NormalizedResponse, RoutingDecision, TelemetryEvent, PricingTable, Override, ...
│   │   ├── routing/             # deterministic scoring + tiebreakers + rationale builder
│   │   ├── evaluation/          # request-requirement evaluation, capability filtering, token estimate
│   │   ├── cost/                # pricing lookup, estimate, reconciliation (FR-019a)
│   │   ├── overrides/           # operator > client precedence resolution
│   │   ├── redaction/           # secret + PII redaction
│   │   └── telemetry/           # event + rollup schemas + rationale serialization
│   └── test/                    # unit tests (vitest)
├── providers/                   # @lca/providers — abstraction + adapters
│   ├── src/
│   │   ├── abstraction/         # Provider interface, capability metadata, HealthProbe
│   │   ├── contract-tests/      # test suite every adapter runs
│   │   ├── mock/                # deterministic Mock adapter (for tests + local dev)
│   │   ├── openai/              # OpenAI adapter (only file allowed to import 'openai')
│   │   └── anthropic/           # Anthropic adapter (only file allowed to import '@anthropic-ai/sdk')
│   └── test/
├── persistence/                 # @lca/persistence — Postgres access
│   ├── src/
│   │   ├── db/                  # pg pool, Kysely bindings, migration runner
│   │   ├── telemetry/           # buffered writer, rollup aggregator, retention job
│   │   ├── pricing/             # pricing-table loader/version pin
│   │   ├── auth/                # API-key store (hashed)
│   │   └── overrides/           # operator_rules loader with cache invalidation
│   └── test/                    # integration tests against dockerized Postgres
├── api/                         # @lca/api — Fastify HTTP entrypoint (thin shell)
│   ├── src/
│   │   ├── server.ts            # Fastify factory + plugin registration
│   │   ├── plugins/             # auth, logging, tracing, metrics, error-mapper
│   │   ├── routes/              # /v1/completions, /v1/routing/preview, /v1/catalog, /v1/telemetry, /v1/health
│   │   └── wiring.ts            # DI composition of core + providers + persistence
│   ├── bench/                   # autocannon + vitest bench (SC-007, SC-011)
│   └── test/                    # supertest integration tests
└── cli/                         # @lca/cli — commander CLI (thin shell)
    ├── src/
    │   ├── bin.ts               # entry
    │   └── commands/            # route, preview, catalog list, telemetry query, replay, override apply, keys ...
    └── test/
```

**Structure Decision**: **npm workspaces monorepo, 5 packages** — `core`, `providers`, `persistence`, `api`, `cli`.

- `core` is I/O-free and vendor-neutral by construction. It is the boundary Principles I and VI protect.
- `providers` is the only package permitted to depend on vendor SDKs; enforced via ESLint's `no-restricted-imports` scoped to non-`providers/*/src` files.
- `persistence` isolates the Postgres surface so `core` and `providers` remain testable without a database.
- `api` and `cli` are thin composition shells. They contain no domain logic.
- Provider adapters ship in `providers` for MVP simplicity (one workspace to manage). If a customer needs to build a private adapter later without pulling OpenAI/Anthropic SDKs, this becomes a real reason to split adapters into their own packages — recorded as a follow-up, not built now (Principle VIII).

## Post-Design Constitution Re-Check

*Performed after Phase 1 artifacts were drafted.*

- **I. Library-First** — Confirmed. `data-model.md` types are declared in `@lca/core`; `contracts/provider.md` interface lives in `@lca/providers`.
- **II. CLI + API Parity** — Every route in `contracts/http-api.yaml` has a matching command in `contracts/cli.md`. Parity contract test planned.
- **III. Test-First** — Contract files (`http-api.yaml`, `provider.md`, `telemetry.md`, `cli.md`) are inputs to test scaffolding; task ordering will place failing tests before implementations.
- **IV. Observability** — Telemetry schema in `data-model.md` and `contracts/telemetry.md` captures every field required by FR-020 (including attempts chain, decision source, shadowed source, pricing-table version).
- **V. Cost Accuracy** — `pricing_tables.version_id` is a required foreign-key reference from every `telemetry_events.pricing_table_version_id`. Reconciliation formula centralized.
- **VI. Provider Abstraction** — `contracts/provider.md` defines a single interface; no vendor-specific extensions leak into other contracts.
- **VII. Security** — HTTP contract requires `Authorization: Bearer <api_key>` on all non-`/health` routes. Redaction gate documented in telemetry contract.
- **VIII. Simplicity** — 5 packages held. No queueing subsystem. No plugin registry.
- **IX. SemVer** — Contracts folder acts as the canonical location for versioned public schemas; changes there drive package MAJOR/MINOR/PATCH decisions.
- **X. Performance Budgets** — Bench harness planned in `packages/api/bench/` mapping to SC-007 and SC-011.

**Result**: Still no violations. Complexity Tracking remains empty.

## Complexity Tracking

*No constitution violations to justify.*
