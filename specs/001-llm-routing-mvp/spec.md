# Feature Specification: LLM Cost Autopilot MVP

**Feature Branch**: `001-llm-routing-mvp`

**Created**: 2026-09-07

**Status**: Draft

**Input**: User description: "Build the MVP of LLM Cost Autopilot: an intelligent LLM orchestration and cost-optimization layer that sits between client applications and multiple LLM providers. Accept an LLM request, normalize it, evaluate requirements, select a model/provider, execute, and return a normalized response. Multi-provider via abstraction. Consider task complexity, capabilities, expected quality, tokens, latency, reliability, cost. Emit structured telemetry with routing rationale. Versioned pricing. Transparent + overridable. Node.js 22+/TS, PostgreSQL, npm, Docker; HTTP framework chosen in plan. Core routing/cost/provider/evaluation as reusable libraries. No Python. No premature ML; MVP routing must be deterministic, measurable, explainable."

## Clarifications

### Session 2026-09-07

- Q: When a client-supplied override and a matching operator rule both apply to the same request, which one is honored? → A: Operator rule wins; client override applies only when no operator rule matches.
- Q: When the chosen provider fails mid-request, how does the platform respond? → A: Single automatic fallback to the next candidate from the same routing decision on transient errors (timeout, rate-limit, upstream 5xx); no fallback on 4xx / client errors; both attempts recorded in one telemetry record.
- Q: What tolerance defines a "reconciled" cost estimate vs. provider-reported cost? → A: Combined threshold `abs(estimated − actual) ≤ max($0.001, 5% × actual)` per request; drift alert fires when the rolling reconciled rate over the trailing 60 minutes OR the 1,000 most-recent reconcilable requests (whichever window closes first) drops below 95%.
- Q: What request-rate envelope should the MVP be designed and load-tested for? → A: 100 req/sec sustained, 500 req/sec burst per deployment, on a single well-sized instance backed by the primary relational store; telemetry writes buffered/batched but no async queue required.
- Q: How long is per-request telemetry retained? → A: Tiered — 30 days full-fidelity records, then aggregated roll-ups keyed by (day × provider × model) retained for 12 months; full-fidelity records past 30 days are deleted.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Cost-aware routed request across multiple providers (Priority: P1)

A client application sends a chat-completion request to the autopilot. The autopilot evaluates the request against its configured catalog of models across at least two providers, deterministically selects the model/provider that best balances the client's stated requirements (max latency, max cost, minimum quality tier, required capabilities) with the platform's cost-optimization policy, executes the call through the corresponding provider adapter, and returns a normalized response to the client.

**Why this priority**: This is the core value proposition. Without this, nothing else in the platform is useful. It also forces the provider abstraction, the model catalog, and the routing library to exist in their minimum viable form.

**Independent Test**: With two mock provider adapters configured (each exposing different price/latency/quality metadata), send a set of requests through the platform's request/response entry point. Verify each response is returned in a single normalized schema regardless of which adapter served it, and that the selected provider matches what the deterministic scoring function predicts for each request's stated requirements.

**Acceptance Scenarios**:

1. **Given** two providers are configured with valid credentials and healthy status, **When** a client submits a chat request with no explicit requirements, **Then** the autopilot picks the lowest-cost model that satisfies the request's estimated token needs and returns a normalized response.
2. **Given** a client submits a request specifying a maximum acceptable latency, **When** one candidate model's published p95 latency exceeds that ceiling, **Then** that model is excluded from selection and a different qualifying model is chosen.
3. **Given** a client submits a request requiring a capability (e.g., tool use) only one provider supports, **When** routing runs, **Then** that provider is selected regardless of cost ordering.
4. **Given** the same request payload and identical catalog state are submitted twice, **When** routing runs both times, **Then** the same model/provider is selected (routing is deterministic).
5. **Given** the estimated input tokens exceed every candidate model's context window, **When** routing runs, **Then** the request is rejected with a clear reason code before any provider is called.

---

### User Story 2 — Auditable telemetry and versioned cost accounting (Priority: P2)

Every request the autopilot handles produces a structured telemetry record that captures the chosen provider and model, input and output token counts, latency, error class (if any), estimated cost, the routing decision, and a machine-readable rationale explaining which factors drove the decision. Each cost value references the exact pricing-table version used to compute it. An operator can query telemetry after the fact and fully reconstruct why a given request was routed the way it was, without re-running the request.

**Why this priority**: The platform's value collapses if users cannot trust the numbers or explain the decisions. This story enforces the constitution's Cost Accuracy and Observability principles from day one and gives the eventual ML-based routing something to learn from.

**Independent Test**: Execute a batch of requests, then query the telemetry store. Verify every record contains all required fields, every cost value carries a pricing-table version identifier, and an audit script can reproduce each routing decision by replaying the recorded inputs against the scoring function.

**Acceptance Scenarios**:

1. **Given** a request is executed successfully, **When** the telemetry record is written, **Then** it contains provider, model, input tokens, output tokens, latency, estimated cost, pricing-table version, routing decision, and routing rationale.
2. **Given** a pricing table has been updated between two requests, **When** telemetry is inspected, **Then** the two records reference different pricing-table version identifiers matching the version live at each request's execution time.
3. **Given** a routing decision was made, **When** an operator replays the recorded request inputs and catalog snapshot through the scoring function, **Then** the reproduced decision matches the one stored in telemetry.
4. **Given** a provider call fails, **When** the telemetry record is written, **Then** it records the error class, the provider/model attempted, latency up to failure, and any partial cost with the pricing-table version.
5. **Given** a telemetry record is stored, **When** it is inspected, **Then** it contains no unredacted secrets and no unredacted personally identifiable information from the request or response payloads.

---

### User Story 3 — Client and operator overrides of autonomous routing (Priority: P3)

A client can pin a specific provider and/or model on an individual request, and an operator can configure routing rules that force certain requests (matching declared criteria) to specific providers or models regardless of autopilot scoring. Every override is honored when the target is valid and available, and the resulting decision is recorded in telemetry with the override source clearly identified.

**Why this priority**: The autopilot is autonomous by default, but the constitution requires humans and integrators to be able to take back the wheel. Shipping without overrides makes the system unadoptable in regulated or high-stakes environments.

**Independent Test**: Submit two functionally identical requests, one with a client override pinning provider B, one without. Verify the overridden request is routed to provider B, the non-overridden one is routed by the autopilot's normal scoring, and both telemetry records identify the decision source correctly (`client_override`, `operator_rule`, or `autopilot`).

**Acceptance Scenarios**:

1. **Given** a client override specifies an available provider/model pair, **When** the request is executed, **Then** that provider/model is used and telemetry records `decision_source = client_override`.
2. **Given** an operator rule matches a request and pins a provider, **When** no client override is present, **Then** the operator rule is honored and telemetry records `decision_source = operator_rule`.
3. **Given** both a client override and a matching operator rule exist, **When** the request is executed, **Then** the operator rule is honored, the client override is recorded as shadowed, and telemetry reflects both the effective source (`operator_rule`) and the shadowed source (`client_override`).
4. **Given** a client override names a model that is not in the catalog or is unhealthy, **When** the request is submitted, **Then** the request fails with a clear reason and no provider call is made (the autopilot does not silently substitute).
5. **Given** any override was in effect, **When** the telemetry record is inspected, **Then** the rationale field explains that autonomous scoring was bypassed and names the source of the override.

---

### Edge Cases

- All configured providers report unhealthy at request time.
- Chosen provider fails mid-request with a transient error (timeout, rate-limit, upstream 5xx): the platform MUST attempt one automatic fallback to the next candidate from the same routing decision's ranked list and MUST record both attempts in a single telemetry record.
- Chosen provider fails mid-request with a client-side error (4xx, invalid request): no fallback is attempted; the error is returned to the client and telemetry records the single failed attempt.
- All candidate models are exhausted (initial attempt + one fallback both fail, or no fallback candidate exists): the platform returns a structured error to the client identifying the terminal failure class, and the telemetry record captures every attempt.
- Pricing table is missing an entry for a model version returned by a provider (e.g., a silently upgraded snapshot).
- Estimated tokens vs. actual tokens diverge significantly, causing pre-call cost estimate to differ from post-call actual.
- Request cannot fit in any candidate model's context window.
- Client override targets a valid model whose provider is currently unhealthy.
- Two candidate models tie on every scoring factor (tiebreaker must be deterministic).
- Provider returns a non-standard error shape the adapter has not seen before.
- Concurrent updates to the pricing table during in-flight requests (which version wins for those requests must be well-defined).
- Very large request payload that would push cost or latency past the client's declared ceilings.

## Requirements *(mandatory)*

### Functional Requirements

#### Request handling and normalization

- **FR-001**: The system MUST accept LLM chat/completion requests through an authenticated network-accessible request/response interface.
- **FR-002**: The system MUST normalize incoming requests into a provider-neutral internal representation before any routing or execution step reads them.
- **FR-003**: The system MUST accept per-request requirements from the client, at minimum: maximum acceptable latency, maximum acceptable cost per request, minimum quality tier, and required capability flags (e.g., tool use, JSON mode, function calling).
- **FR-004**: The system MUST return responses to clients in a single normalized response schema, independent of which provider served the request.

#### Provider abstraction

- **FR-005**: The system MUST expose a provider abstraction that all provider adapters implement, covering: send request, report capability metadata, report health, and expose pricing descriptor references.
- **FR-006**: The MVP MUST ship with at least two provider adapters (real or mock) that are interchangeable behind the abstraction.
- **FR-007**: Core routing, cost, evaluation, and telemetry logic MUST depend only on the abstraction and MUST NOT import any vendor-specific SDK directly.
- **FR-008**: Adding a new provider MUST require only implementing the adapter interface and its contract tests, with no changes to core routing logic.

#### Routing (deterministic MVP)

- **FR-009**: The system MUST evaluate each request against a catalog of models drawn from all healthy configured providers.
- **FR-010**: The routing algorithm MUST consider at minimum: estimated task complexity, model capability match, published quality tier, estimated token usage, published latency profile, published reliability signal, and estimated cost.
- **FR-011**: The routing algorithm MUST be deterministic: identical inputs (request + catalog snapshot + pricing snapshot + config) MUST produce identical routing decisions.
- **FR-012**: The routing algorithm MUST produce a machine-readable rationale for every decision, itemizing which factors ruled candidates in or out and the final selection reason.
- **FR-013**: The routing algorithm MUST NOT use any online machine-learning inference in the MVP; scoring MUST be a documented, deterministic function.
- **FR-014**: The routing capability MUST be usable in isolation from the network-facing entry point and from any specific transport or persistence choice, so it can be embedded or reused in other execution contexts.

#### Cost accuracy and pricing

- **FR-015**: The system MUST maintain pricing data as versioned, timestamped, data-driven tables — not as scattered code constants.
- **FR-016**: Every cost value emitted (estimated or reconciled) MUST reference the exact pricing-table version identifier used to compute it.
- **FR-017**: The system MUST expose a pre-call cost estimate for the chosen model based on the estimated input token count and the model's published output-length assumptions.
- **FR-018**: The system MUST record a post-call cost value using the actual reported input/output tokens for the response.
- **FR-019**: When a provider returns usage or billing data, the system MUST record it alongside the internal estimate for later reconciliation.
- **FR-019a**: A request is considered "reconciled" when `abs(estimated_cost − actual_cost) ≤ max($0.001, 0.05 × actual_cost)`. The system MUST compute this reconciliation flag for every request that has both an estimated and an actual cost. The system MUST raise a drift alert when the rolling reconciled-request rate drops below 95% over a window defined as: the trailing 60 minutes OR the 1,000 most-recent reconcilable requests, whichever bound is reached first. The alert MUST clear once the rolling rate returns to ≥ 95% for one full window.

#### Telemetry and observability

- **FR-020**: The system MUST persist a structured telemetry record for every request handled (success or failure), containing at minimum: request identifier, timestamp, decision source, effective provider, effective model, ordered attempts chain (see FR-034), aggregated input tokens, aggregated output tokens, total end-to-end latency, terminal error class (if any), estimated cost, actual cost (if computable), pricing-table version, and routing rationale.
- **FR-021**: A correlation identifier MUST be propagated from ingress through the provider call and back into the response and telemetry record.
- **FR-022**: Telemetry records MUST be sufficient to reconstruct a routing decision without re-running the request.
- **FR-023**: The system MUST redact secrets and PII from any persisted request/response snippets according to a documented redaction policy.
- **FR-023a**: The system MUST retain full-fidelity per-request telemetry records for 30 days from the request timestamp, then delete them. Before deletion, the system MUST aggregate the retiring records into daily roll-ups keyed by (date, provider, model) capturing at minimum: request count, success/failure counts by terminal error class, aggregated input/output tokens, aggregated estimated cost, aggregated actual cost, aggregated latency percentiles (p50/p95/p99), reconciled-request rate, and count by decision source. Roll-ups MUST be retained for 12 months from the aggregation date. Deletion and aggregation MUST be idempotent and MUST NOT interfere with in-flight audit queries.

#### Overrides and transparency

- **FR-024**: Clients MUST be able to submit an override on a per-request basis pinning a specific provider and/or model.
- **FR-025**: Operators MUST be able to configure routing rules that force matching requests to specific providers/models.
- **FR-026**: Every telemetry record MUST identify the decision source as one of: `autopilot`, `client_override`, `operator_rule`.
- **FR-027**: Override precedence MUST be: operator rule > client override > autopilot. When a request matches an operator rule, that rule is honored and any client override is shadowed. A client override applies only when no operator rule matches the request. Telemetry MUST record the effective source and, when a client override was shadowed by an operator rule, MUST also record the shadowed source.
- **FR-028**: When an override names a target that is not in the catalog or is unhealthy, the system MUST fail the request with a clear reason and MUST NOT silently substitute a different target.

#### Reliability and failure behavior

- **FR-029**: The system MUST track health/availability per provider adapter and exclude unhealthy providers from routing candidates.
- **FR-030**: The system MUST reject requests whose estimated token count exceeds every candidate model's context window, with a clear reason code, before calling any provider.
- **FR-031**: The system MUST define and apply deterministic tiebreaker rules when multiple candidate models score equally.
- **FR-032**: The system MUST enforce timeouts on provider calls and record timeout as a distinct error class in telemetry.
- **FR-033**: On a transient failure of the initially chosen provider (timeout, rate-limit, or upstream 5xx), the system MUST attempt exactly one automatic fallback to the next candidate model from the same original routing decision's ranked list. No cross-provider fallback MUST be attempted on client-side errors (4xx / invalid request) or on failures from an override target.
- **FR-034**: When a fallback is attempted, the platform MUST record all attempts (initial + fallback) as an ordered `attempts` chain within a single telemetry record for the request, capturing per attempt: provider, model, latency, error class (if any), input/output tokens (if reported), and estimated cost with pricing-table version.
- **FR-035**: When both the initial attempt and the single fallback attempt fail, the platform MUST return a terminal structured error to the client identifying the final failure class and MUST NOT attempt further fallbacks.

#### Security

- **FR-036**: Provider credentials MUST be sourced from a controlled secret-management mechanism and MUST NOT appear in logs, error messages, telemetry records, or responses.
- **FR-037**: All externally reachable endpoints MUST require authentication by default.

### Key Entities

- **Normalized LLM Request**: Provider-neutral representation of a client request, including messages/prompt, model constraints, per-request requirements (latency, cost, quality, capabilities), optional override, correlation identifier, and client identity.
- **Normalized LLM Response**: Provider-neutral response containing generated content, usage counts, finish reason, and correlation identifier.
- **Provider**: An external LLM vendor represented internally by an adapter that reports capability metadata, health, and pricing descriptor references, and exposes a uniform send-request operation.
- **Model**: A named capability offered by a provider, described by capability flags (context window, modalities, tool use, streaming), published quality tier, published latency and reliability profile, and a pricing descriptor reference.
- **Pricing Table**: A versioned, timestamped dataset mapping (provider, model) to unit prices for input and output tokens (and any other billable dimensions), with a stable version identifier referenced from every cost calculation.
- **Routing Decision**: The record of which model/provider was selected for a request, produced by the deterministic scoring function, including a machine-readable rationale of contributing factors and the decision source.
- **Override**: A rule or per-request directive that pins a provider/model and bypasses autonomous scoring; carries its source (`client_override` or `operator_rule`) and precedence metadata.
- **Telemetry Record**: The durable per-request audit entry combining request identity, routing decision, execution result, token usage, latency, estimated and actual cost, pricing-table version, redacted payload references, and error class if applicable.
- **Provider Health Signal**: The current availability status of a provider adapter, used to include or exclude the provider from routing candidates.
- **Telemetry Rollup**: An aggregated per-day, per-provider, per-model summary derived from expiring full-fidelity telemetry records, capturing request counts, terminal error breakdowns, aggregated token usage and cost (estimated and actual), latency percentiles, reconciled-request rate, and decision-source counts. Roll-ups outlive the underlying records and support long-range trend analysis after the 30-day full-fidelity window closes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of requests handled by the autopilot (successful or failed) produce a telemetry record containing every field required by FR-020.
- **SC-002**: 100% of cost values recorded in telemetry reference a specific, versioned pricing-table identifier that resolves to a real pricing snapshot.
- **SC-003**: An operator can, using only telemetry, reproduce every routing decision for a sample of 100 past requests such that the reproduced decision matches the recorded decision in every case.
- **SC-004**: The autopilot supports at least two distinct LLM providers behind the same client-facing contract in the MVP, and swapping which provider handles a given request requires no client-side code change.
- **SC-005**: Adding a new provider to the MVP requires only implementing the adapter interface and passing the standard contract test suite; core routing files are not modified.
- **SC-006**: Client override directives are honored on 100% of requests where the named target is present in the catalog and healthy; requests with invalid override targets fail with a clear reason and never silently fall back.
- **SC-007**: For a representative benchmark request set, the added routing overhead introduced by the autopilot stays within the constitution's default performance budgets (median ≤ 20 ms, p95 ≤ 75 ms).
- **SC-008**: For requests where the provider returns usage/billing data, the estimated cost matches the provider-reported cost within the reconciliation tolerance defined by FR-019a (`abs(estimated − actual) ≤ max($0.001, 5% × actual)`) for at least 95% of requests measured over the FR-019a rolling window (trailing 60 minutes OR 1,000 most-recent reconcilable requests, whichever closes first).
- **SC-009**: No secret material and no unredacted personally identifiable information appears in any persisted log, telemetry record, or error output across the acceptance test suite.
- **SC-010**: The core routing capability is exercisable end-to-end (evaluate → select → produce rationale) by tests that do not depend on the network-facing entry point or on any specific transport.
- **SC-011**: A single deployment sustains 100 requests/second continuously and absorbs bursts up to 500 requests/second for at least 60 seconds without violating the routing overhead budgets in SC-007 and without loss of telemetry records.

## Assumptions

- The MVP scope is text-based chat/completion requests. Embeddings, image, audio, and other modalities are out of scope for this iteration.
- Streaming responses are out of scope for the MVP; the autopilot returns full responses only. Streaming support is a foreseeable follow-up feature.
- Real deployments will configure at least two providers with valid credentials. In development and CI, mock providers stand in.
- Pricing tables are curated by operators (loaded from data files or a database seed) and updated out of band. Automatic scraping or ingestion of vendor pricing pages is out of scope for the MVP.
- The MVP operates as a single-tenant service. Multi-tenant isolation, per-tenant quotas, and per-tenant billing rollups are out of scope for this iteration.
- The MVP targets a single-node deployment sized to sustain 100 req/sec with 500 req/sec bursts (see SC-011). Horizontal scaling and an async telemetry pipeline are deliberately out of scope for this iteration; telemetry may be written via buffered/batched inserts but no message queue is required.
- Client authentication uses an industry-standard token-based scheme; the exact mechanism is finalized in the planning phase.
- Rate limiting, quota enforcement, and budget caps per client/tenant are out of scope for the MVP but the telemetry schema must be sufficient to build them later.
- The initial routing scoring function is deterministic and hand-tuned. Any move to ML-based routing is deferred until enough telemetry has been collected to justify and evaluate it.
- Concrete stack choices (runtime, transport framework, persistence engine, packaging, CI) are governed by the project constitution and finalized during `/speckit-plan`. This specification intentionally stays technology-agnostic so the requirements above remain valid regardless of those choices.
