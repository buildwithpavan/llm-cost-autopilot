<!--
Sync Impact Report
- Version change: (uninitialized template) → 1.0.0
- Rationale: Initial ratification. The prior file contained only unfilled template
  placeholders and no governed content, so this is the first substantive constitution.
- Modified principles: none (no prior named principles existed)
- Added sections:
  - Core Principles: I. Library-First, II. CLI + API Parity, III. Test-First
    (NON-NEGOTIABLE), IV. Observability, V. Cost Accuracy, VI. Provider Abstraction,
    VII. Security & Secret Hygiene, VIII. Simplicity / YAGNI, IX. Semantic Versioning
    & Breaking Change Policy, X. Performance Budgets
  - Additional Constraints & Stack Requirements
  - Development Workflow & Quality Gates
  - Governance
- Removed sections: none
- Templates requiring updates: none identified in this repo at ratification time.
  Downstream Spec Kit templates read this file at runtime.
- Deferred / TODOs: none
-->

# LLM Cost Autopilot Constitution

LLM Cost Autopilot is an intelligent orchestration and optimization layer between
applications and Large Language Model providers. It routes each request to the most
appropriate model/provider based on task complexity, expected quality, latency,
reliability, token usage, and cost; captures rich telemetry on usage and outcomes;
and continuously improves routing decisions while remaining transparent and
overridable by humans.

## Core Principles

### I. Library-First

Core domain logic (routing, cost estimation, provider adapters, evaluation,
telemetry) MUST live in self-contained, independently testable libraries under the
project's package structure. Application entry points (HTTP API, CLI, workers) MUST
be thin shells that compose these libraries. Libraries MUST NOT depend on framework
globals, request context, or process-level singletons.

**Rationale**: Keeps the optimization engine reusable, embeddable, and portable
across deployment shapes (SDK, sidecar, service) and prevents lock-in to a single
runtime topology.

### II. CLI + API Parity

Every user-facing capability — routing a request, inspecting costs, replaying a
decision, exporting reports, overriding autonomous behavior — MUST be reachable via
both the HTTP API and the CLI. CLI commands MUST accept stdin/args, emit JSON on
stdout and human-readable output on stderr behind a flag, and return non-zero exit
codes on failure. New API endpoints without a corresponding CLI surface (or vice
versa) MUST be rejected in review unless the missing surface is filed as a tracked
follow-up before merge.

**Rationale**: Guarantees automation, debuggability, and offline operator control
match interactive usage — critical for a system that governs spend.

### III. Test-First (NON-NEGOTIABLE)

TDD is mandatory. For any change to core libraries, contracts, or routing/cost
behavior: failing tests MUST be written and reviewed first, then implementation
follows until they pass. Contract tests MUST exist for every provider adapter and
every public API/CLI surface. Cost calculation changes MUST include tests against a
frozen fixture set of provider pricing snapshots. Merging code whose behavior is
not covered by a test that would fail without it is prohibited.

**Rationale**: Cost and routing logic are financial-impact code paths;
regressions are silent and expensive without airtight tests.

### IV. Observability

Every request handled by the platform MUST emit structured logs (JSON) and metrics
covering: provider, model, input/output token counts, latency, error class,
estimated cost, routing decision, and decision rationale (which features drove the
choice). Distributed tracing MUST propagate a correlation ID from ingress through
provider calls and back. Logs MUST NOT contain secrets or unredacted PII. A
decision made by the autopilot MUST be reconstructable from stored telemetry
without re-running the request.

**Rationale**: Optimization requires measurement; explainability and audit require
that every autonomous decision leaves a durable, queryable trail.

### V. Cost Accuracy

Cost figures reported by the platform MUST be deterministic and auditable. Pricing
tables MUST be versioned, timestamped, and stored as data (not hard-coded scattered
constants). Each cost value emitted MUST reference the pricing-table version used
to compute it. Estimated vs. billed cost MUST be reconciled where provider
invoices/usage APIs are available, and any drift beyond a documented tolerance
MUST raise an alert. Rounding rules and currency handling MUST be centralized in
one module.

**Rationale**: If users cannot trust the numbers, they cannot trust the routing
decisions built on top of them.

### VI. Provider Abstraction

All interactions with LLM providers MUST go through a provider abstraction layer
that exposes a vendor-neutral request/response contract, capability metadata
(context window, modalities, streaming, tool use), and a pricing descriptor. Core
domain code (routing, evaluation, cost, telemetry) MUST depend only on this
abstraction, never on a specific vendor SDK. Adding a new provider MUST require
implementing the adapter interface plus contract tests, with no changes to core
routing logic. Vendor-specific behavior MUST be expressed as capability flags on
the adapter, not as conditionals in core code.

**Rationale**: Vendor neutrality is a product requirement, not an implementation
detail; coupling core logic to any single vendor destroys the platform's value.

### VII. Security & Secret Hygiene

Provider API keys, customer secrets, and tenant credentials MUST NOT appear in
source control, logs, error messages, traces, telemetry payloads, or CLI output.
Secrets MUST be loaded from environment variables or a dedicated secret store at
process boundaries only. Request and response payloads MUST pass through a
configurable PII/secret redaction layer before being persisted or logged. All HTTP
endpoints MUST require authentication by default; unauthenticated routes MUST be
explicitly opted in and justified in the PR description. Dependencies MUST be
scanned for known vulnerabilities in CI, and high/critical findings block merge.

**Rationale**: The platform sits on the hot path of production LLM traffic and
holds credentials for multiple vendors; a leak is a multi-party incident.

### VIII. Simplicity / YAGNI

Introduce abstractions only when a second concrete use case exists or a principle
here demands it. New services, queues, caches, databases, and configuration knobs
MUST be justified in the plan with the problem they solve and the cost of not
having them. Speculative flexibility (parameters no caller uses, plugin points
with one implementation, generic frameworks around one-off needs) MUST be
rejected. Prefer deleting code over adding it when both satisfy the requirement.

**Rationale**: A cost-optimization product that is expensive to operate or reason
about undermines its own value proposition.

### IX. Semantic Versioning & Breaking Change Policy

The platform and its published libraries MUST follow SemVer (MAJOR.MINOR.PATCH).
Breaking changes to public API contracts, CLI flags/output schemas, provider
adapter interfaces, telemetry schemas, or pricing-table schemas MUST bump MAJOR
and MUST ship with a migration note in the release. Additive, backward-compatible
changes bump MINOR. Fixes and internal refactors bump PATCH. Deprecations MUST be
announced at least one MINOR release before removal and MUST emit a runtime
warning while active.

**Rationale**: Downstream integrators depend on stable contracts; silent breaks
in a cost-governance layer erode trust immediately.

### X. Performance Budgets

The routing/optimization layer MUST add bounded overhead to each request. Default
budgets (overridable per deployment with justification):

- Added p50 latency: ≤ 20 ms
- Added p95 latency: ≤ 75 ms
- Added p99 latency: ≤ 150 ms
- Steady-state per-request CPU overhead: ≤ 5 ms
- Per-request additional memory allocation: ≤ 1 MB

Every PR touching the request path MUST report benchmark results against these
budgets. Regressions beyond budget MUST block merge unless an explicit, time-boxed
waiver is recorded in the PR and tracked as follow-up.

**Rationale**: If the autopilot slows requests more than it saves, it fails its
core mission.

## Additional Constraints & Stack Requirements

- **Runtime**: Node.js 22+ with TypeScript for the core application and all
  first-party libraries. `strict` mode MUST be enabled; `any` requires
  justification in code review.
- **HTTP framework**: A modern Node.js HTTP framework selected during the
  `/speckit-plan` phase. The choice MUST be documented in the plan with rationale
  and MUST be swappable behind the thin-shell boundary required by Principle I.
- **Database**: PostgreSQL is the primary relational store. Additional stores
  (cache, queue, vector, timeseries) MUST be justified per Principle VIII.
- **Package management**: npm. Lockfile MUST be committed. Dependency additions
  MUST be reviewed for license, maintenance status, and security posture.
- **Containers**: Docker MUST be used for reproducible development and deployment
  environments. Images MUST be built in CI from pinned base images.
- **CI/CD**: GitHub Actions. Required checks: build, typecheck, lint, unit tests,
  contract tests, dependency vulnerability scan, and secret scan. All required
  checks MUST pass before merge.
- **Language boundary**: Python, FastAPI, Uvicorn, and any separate Python-based
  AI service MUST NOT be introduced unless a future requirement is explicitly
  documented, reviewed, and ratified as an amendment to this constitution.
- **Provider neutrality (stack level)**: No environment, config, or build step
  may hard-require a specific LLM vendor. Local development MUST be possible with
  a mock provider adapter and without any real vendor credentials.

## Development Workflow & Quality Gates

- **Spec Kit workflow**: Substantive features MUST follow the Spec Kit flow —
  `/speckit-specify` → `/speckit-clarify` (when scope is unclear) →
  `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`, with
  `/speckit-analyze` run before implementation on non-trivial changes.
- **Reviews**: Every PR MUST have at least one reviewer who did not author the
  change. Reviewers MUST verify constitution compliance and call out violations
  by principle number.
- **Quality gates (merge-blocking)**: typecheck clean, lint clean, unit and
  contract tests green, coverage not regressed on touched files, vulnerability
  and secret scans clean, performance budgets (Principle X) respected for
  request-path changes.
- **Autonomy controls**: Any change that expands the scope of autonomous
  decisions the platform can make without human input MUST ship with (a) an
  override mechanism reachable via both API and CLI (Principle II), (b)
  telemetry that makes each such decision reconstructable (Principle IV), and
  (c) a documented rollback path.
- **Complexity justification**: Any deviation from Principles I, VI, VIII, or X
  MUST be recorded in the plan's Complexity Tracking section with the concrete
  reason and the simpler alternative that was rejected.

## Governance

- This constitution supersedes ad-hoc practices and prior conventions. Where a
  team norm conflicts with a principle here, the principle wins until amended.
- **Amendment procedure**: Amendments are proposed by opening a PR that modifies
  this file, updates the version per the rules below, and includes a Sync Impact
  Report at the top of the file. Amendments MUST be reviewed by at least one
  maintainer and MUST document the migration impact on existing code.
- **Versioning policy** (of this constitution):
  - MAJOR: A principle is removed, renamed in a way that changes its meaning, or
    its non-negotiable rules are materially relaxed; or a governance rule is
    removed or made significantly less strict.
  - MINOR: A new principle or section is added, or existing guidance is
    materially expanded/tightened.
  - PATCH: Clarifications, wording, typo fixes, examples, or non-semantic
    refinements that do not change what is required.
- **Compliance review**: Reviewers MUST verify constitution compliance on every
  PR. A quarterly review MUST audit a sample of merged PRs against these
  principles and file follow-ups for systemic gaps.
- **Runtime guidance**: Spec Kit commands (`/speckit-specify`, `/speckit-plan`,
  `/speckit-tasks`, `/speckit-implement`, `/speckit-analyze`, etc.) read this
  file at runtime; keep it authoritative and current.

**Version**: 1.0.0 | **Ratified**: 2026-09-07 | **Last Amended**: 2026-09-07
