# LLM Cost Autopilot — Frontend Product Architecture

**Status**: Design brief. No frontend code has been written.

**Scope**: Defines the shape of the operator/developer-facing frontend for the completed backend MVP. Grounded exactly in the ratified contracts (`specs/001-llm-routing-mvp/contracts/http-api.yaml`, `contracts/telemetry.md`, `contracts/provider.md`, `data-model.md`). Nothing in this document assumes an API the backend does not already implement.

**Reviewers**: To be reviewed against Figma designs before implementation begins.

---

## A. Product UX goals

The frontend has one job: **make it obvious why the autopilot chose what it chose, and let a human take back the wheel when they need to.**

The concrete UX goals, in priority order:

1. **Explainability** — Every routing decision is reconstructable and inspectable. No black boxes.
2. **Cost visibility** — Estimated vs actual cost, reconciliation status, and drift are always one click away.
3. **Safe governance** — Operators can create, dry-run, and audit rules without fear of breaking traffic.
4. **Developer respect** — Every screen has a raw JSON view, curl snippet, and correlation ID. The CLI is a first-class citizen; the UI is not the only way to work.
5. **Signal over decoration** — Density and rigor over flashy charts. This is dev-infrastructure, not marketing analytics.

Explicit non-goals for the MVP UI:

- No end-user "chat playground" — the autopilot is not a chat app.
- No AI-generated commentary/insights — every conclusion the UI states must come from computed data.
- No multi-tenant workspace switching — the backend is single-tenant.
- No editorializing of provider vendors — treat them as equals.

## B. Target users / personas

Three personas, distinct enough to warrant different landing views on the same data.

### B.1 Developer / API consumer ("Dana")

- Integrates the autopilot's HTTP API into their application.
- Cares about: request-response schema, latency, error classes, correlation IDs, override syntax, API-key rotation.
- Sees the UI as documentation-adjacent — jumps between the UI and their own logs via `x-request-id`.
- Must be able to answer, in seconds: "What happened to request `abc-123`?"

### B.2 Engineering / Platform operator ("Ola")

- Runs the autopilot as a service inside their org.
- Cares about: provider health, fallback rates, rule impact, drift alerts, retention, incident triage.
- Uses the UI during on-call.
- Must be able to answer: "Why did requests to `openai:gpt-4o` spike today? Is any rule shadowing them?"

### B.3 Cost / FinOps user ("Fin")

- Owns the LLM budget.
- Cares about: daily/weekly cost by provider × model × client, reconciliation health, forecast vs actual, override-driven cost changes.
- Uses the UI for periodic review, not real-time.
- Must be able to answer: "Did last week's rule change lower our cost, and by how much?"

Each persona has a distinct default landing view (§ C). Nothing is persona-locked — all three personas can navigate everywhere.

## C. Application information architecture

Four top-level sections, one persona-facing entry point each, plus a shared inspector. The persona affinity is a soft hint (default landing card set), not a permission gate.

```
LLM Cost Autopilot
├── Overview                  ← Dana, Ola, Fin all land here by default
│   └── (persona-tuned card layout)
├── Traffic
│   ├── Routing Explorer      ← Dana
│   ├── Request Detail        ← anyone with a request ID
│   └── Replay Console        ← Dana + Ola
├── Governance
│   ├── Operator Rules
│   ├── API Keys
│   └── Rule Impact Timeline  ← Ola
├── Catalog
│   ├── Providers & Health
│   ├── Models
│   └── Pricing Snapshots     ← Fin
├── Cost
│   ├── Cost Dashboard        ← Fin
│   ├── Reconciliation
│   └── Rollups Explorer
└── Observability
    ├── Health
    ├── Metrics (Prometheus embed / link-out)
    └── Retention Status
```

The **Routing Decision Visualizer** (§ K) is not a page — it is a reusable component embedded in Overview, Routing Explorer, Request Detail, Replay Console, and Rule Impact Timeline.

## D. Proposed routes / pages

Route naming is opinionated: no `/dashboard/`, no `/admin/`. Everything is under `/app/` to keep the marketing surface reserved.

| Route | Page | Primary persona | Contains Routing Visualizer? |
|---|---|---|---|
| `/app/` | Overview | all | Yes (miniature, for the latest N requests) |
| `/app/traffic` | Routing Explorer (list + filters) | Dana | No — list view |
| `/app/traffic/:eventId` | Request Detail | all | **Yes — canonical placement** |
| `/app/traffic/replay/:eventId` | Replay Console | Dana / Ola | Yes (side-by-side recorded vs replayed) |
| `/app/governance/rules` | Operator Rules list + editor | Ola | Yes (in the rule dry-run panel) |
| `/app/governance/rules/:ruleId` | Rule Detail + Impact | Ola | Yes (per-affected-request preview) |
| `/app/governance/keys` | API Keys | Dana / Ola | No |
| `/app/catalog` | Providers overview | Ola | No |
| `/app/catalog/providers/:providerId` | Provider detail (models + health history) | Ola | No |
| `/app/catalog/models/:modelId` | Model detail | Fin / Ola | No |
| `/app/catalog/pricing` | Pricing Snapshots list | Fin | No |
| `/app/catalog/pricing/:versionId` | Pricing Snapshot detail | Fin | No |
| `/app/cost` | Cost Dashboard | Fin | No |
| `/app/cost/reconciliation` | Reconciliation Health | Fin / Ola | No |
| `/app/cost/rollups` | Rollups Explorer | Fin | No |
| `/app/observability/health` | Health + dependency status | Ola | No |
| `/app/observability/metrics` | Metrics (embed or link-out to Prometheus) | Ola | No |
| `/app/observability/retention` | Retention job status | Ola | No |
| `/app/settings/self` | Own account + key metadata | all | No |
| `/app/help/api` | Live API reference (embed of `contracts/http-api.yaml`) | Dana | No |
| `/app/help/cli` | Live CLI reference | Dana | No |

## E. What information each page must display

Only pages that are non-obvious from § D or that carry backend-contract requirements are enumerated. Everything else follows the section-specific requirements in § I–S.

### E.1 Overview (`/app/`)

- Live traffic pulse (requests/min, autopilot vs override share, non-2xx rate) for the last 60 minutes.
- Active reconciliation rate + alert state (from `/metrics`).
- Latest N requests (5-10) with a mini Routing Visualizer thumbnail per row.
- Active pricing snapshot version + effective-since timestamp.
- Provider health strip (green/yellow/red chip per provider from `provider_health_state`).
- Persona-hint cards: Dana → "recent requests + docs"; Ola → "rules + health"; Fin → "cost today + reconciliation".

### E.2 Request Detail (`/app/traffic/:eventId`)

The single most important read-only page.

- Header: `eventId`, `receivedAt`, `clientId`, `decisionSource`, `shadowedSource`, `terminalErrorClass`.
- Correlation strip: request-id, response header, telemetry event, trace link (if OTel endpoint is configured).
- **Routing Decision Visualizer** (§ K) as the hero component.
- Attempts chain (§ O) with per-attempt cards.
- Cost panel: estimated, actual, reconciled flag, pricing-table version link.
- Redacted payload preview (routing rationale only; user messages are not persisted).
- Actions: "Replay decision", "Copy curl", "Copy `lca telemetry replay`", "Open trace".
- Related: link to the operator rule (if any) that shadowed a client override.

## F. Which backend endpoints each page consumes

Only endpoints that already exist in `contracts/http-api.yaml`. No new endpoints are proposed.

| Page | Endpoint(s) |
|---|---|
| Overview | `GET /v1/health`, `GET /metrics` (parsed client-side), `GET /v1/telemetry/events?limit=10`, `GET /v1/catalog` |
| Routing Explorer | `GET /v1/telemetry/events` (filter + cursor) |
| Request Detail | `GET /v1/telemetry/events?…` (single event fetch via existing filter+limit=1 or a client-side cache; if a dedicated `/events/{id}` is ever added it plugs in cleanly) |
| Replay Console | `GET /v1/telemetry/replay/{eventId}` |
| Operator Rules list | `GET /v1/operator/rules` |
| Rule editor (dry-run) | `POST /v1/routing/preview` with a synthetic request that includes the rule under test (see § Q for the workflow — no new endpoint needed) |
| Rule create/update/delete | `POST/PATCH/DELETE /v1/operator/rules[/{ruleId}]` |
| API Keys | `GET /v1/keys`, `POST /v1/keys`, `DELETE /v1/keys/{keyId}` |
| Providers | `GET /v1/catalog` (per-provider derivation); provider health status is embedded in the catalog response via the healthy-filter applied by `buildCatalog` |
| Models | `GET /v1/catalog` + `GET /v1/telemetry/rollups?providerId=&modelId=` for usage history |
| Pricing Snapshots | *Not directly exposed by the current API surface* — see § U (open questions). Falls back to inference from telemetry `pricingTableVersionId` field until a dedicated endpoint is added. |
| Cost Dashboard | `GET /v1/telemetry/rollups?fromDate=&toDate=` |
| Reconciliation | `GET /metrics` (scrape `lca_reconciliation_rate`, `lca_reconciliation_alert_active`) + `GET /v1/telemetry/events?since=&until=` filtered client-side on `reconciled` |
| Rollups Explorer | `GET /v1/telemetry/rollups` |
| Health / Retention | `GET /v1/health`, `GET /metrics` |

**Auth**: every non-public request uses `Authorization: Bearer <api_key>`. The `x-request-id` header is client-generated (UUID v4) for correlation and echoed back by the API.

## G. Core frontend domain models

All frontend domain models are direct mirrors of `packages/core/src/types/*.ts`. The frontend imports zod schemas via a lightweight `@lca/schemas` re-export (proposed) or duplicates the shapes as generated types (via `openapi-typescript` against `contracts/http-api.yaml`). Either path is acceptable — Figma decision.

Core shapes the UI cares about (names verbatim from the backend):

- `TelemetryEvent` — the atomic unit of the traffic surface. Every list-view row and every detail page is a projection of this.
- `RoutingDecision` — the object the Routing Visualizer renders.
- `CandidateScore[]` — the ranked list including excluded candidates and their reasons.
- `RationaleEntry[]` — per-factor human-readable notes.
- `Attempt[]` — the fallback chain (length 1 or 2 for MVP).
- `ErrorClass` — the terminal outcome enum.
- `Model`, `PricingEntry`, `PricingTable` — catalog shapes.
- `OperatorRule`, `RuleMatch`, `RulePin` — governance shapes.
- `ApiKeyMetadata` — key list shape (never contains `hashedSecret`).
- `ProviderHealthState` — derived from the catalog + health probes.
- `TelemetryRollup` — the aggregate shape used by all cost/analytics charts.

Frontend-only computed shapes (derived, not persisted):

- `TrafficPulse` — 60-second sliding window over `TelemetryEvent[]` with per-decision-source counts.
- `RoutingDecisionGraph` — a UI-only intermediate that transforms `RoutingDecision + Attempt[]` into the node/edge structure the Visualizer renders.
- `RuleImpactPreview` — a UI-only diff between "with rule" and "without rule" `RoutingDecision`s for a sampled request.

## H. Global navigation structure

- **Top bar**: product name (link to `/app/`), global request-ID search (dispatches to `/app/traffic/:eventId`), environment selector (dev/staging/prod — pulled from local storage, hits the corresponding `--api-url`), reconciliation-alert dot (red when `lca_reconciliation_alert_active = 1`, click → `/app/cost/reconciliation`), account menu.
- **Left rail** (collapsible): 6 sections from § C (Overview, Traffic, Governance, Catalog, Cost, Observability). Sections that are single-page collapse to their route; multi-page sections expand.
- **Contextual right rail** on detail pages: schema view (`show as JSON`), curl+CLI snippet, correlation strip.
- **Command palette** (⌘K): jump to request by ID, jump to rule, jump to model, "open the request I copied to clipboard".
- **Breadcrumbs**: always show provenance for detail pages, e.g. `Traffic › Request abc-123 › Replay`.

## I. Dashboard (Overview) requirements

The overview is a **status page for the autopilot itself**, not a marketing dashboard.

Must show:

1. **System readiness strip** — one row: DB reachable, active pricing version present, N healthy providers of M configured, alert state.
2. **Traffic pulse** — one line chart, last 60 minutes, requests/sec bucketed by 10-second intervals. Layered by `decisionSource` (autopilot / client_override / operator_rule). Right-hand axis: non-2xx rate.
3. **Latest activity** — 8 most-recent telemetry events. Each row: request-id, timestamp, effective provider:model, decision source, terminal error class, latency, estimated cost. Row click → Request Detail. Row hover → mini Routing Visualizer preview.
4. **Cost today** — a single number card: estimated USD today (rollup-derived when older than 30 days; live telemetry sum for today). Delta vs same time yesterday.
5. **Reconciliation health** — the current `lca_reconciliation_rate` as a gauge (0.95 is the alert threshold; render a marker line).

Must NOT show:

- Random KPI tiles.
- AI-generated commentary.
- Any metric not directly derivable from the backend responses.

## J. Routing Explorer requirements

A **filterable, cursor-paginated table** over `GET /v1/telemetry/events`. Feels closer to a Chrome DevTools network tab than a BI report.

Filters that map 1:1 to query params:

- `clientId` (autocomplete over recent values)
- `providerId` (from `/v1/catalog`)
- `modelId` (dependent on provider selection)
- `since` / `until` (relative presets: 5m / 1h / 24h / 7d, plus absolute)
- `limit` (25 / 50 / 100 / 200 / 500)

Client-side filters (post-fetch, no backend param):

- `decisionSource` (autopilot / client_override / operator_rule)
- `shadowedSource` present / not present
- `terminalErrorClass` (per enum value)
- `reconciled` (true / false / null)
- `attempts.length` (1 or 2)

Columns (sortable client-side within the current page):

- Time
- Request ID (truncated, click-to-copy)
- Client
- Effective provider:model
- Decision source (badge; shadowed badge if applicable)
- Attempts (1 dot, or 2 with the first colored by error class)
- Latency (ms)
- Estimated cost (USD, 6 dp)
- Reconciled (✓ / ✗ / —)

Row selection reveals an inline mini Routing Visualizer without navigating away. Row click navigates to `/app/traffic/:eventId`.

## K. Routing Decision visualization requirements — SIGNATURE COMPONENT

This is the anchor product surface. Every other page is either a way to reach it or a way to filter what it renders.

### K.1 What it must communicate

For any single `TelemetryEvent`, the visualizer must tell a five-part story a human can read in one glance:

1. **What was asked** — the request's normalized requirements (max latency, max cost, capabilities, quality tier, override, estimated tokens).
2. **What was available** — the catalog snapshot at ingress time (models × providers × health × pricing version).
3. **What was filtered out and why** — every excluded `CandidateScore` shown with its `exclusionReason`.
4. **How the survivors ranked** — the included candidates ordered by `scoreBreakdown.total` with the per-factor breakdown revealed on hover/click.
5. **What actually happened** — the attempts chain against the chosen model, terminal error class, cost, latency, and (if fallback) the reason for the second attempt.

### K.2 Visual model — the "routing lane"

Not a generic chart. A left-to-right **routing lane** with 6 stages, each a horizontal band. The request travels from stage 1 (top) to stage 6 (bottom). The lane widths carry meaning; every element carries data.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  1. Request                                                                    │
│     req-id · clientId · estimatedInputTokens · required capabilities           │
│     requirements ceiling: latency ≤ Xms · cost ≤ $Y · quality ≥ tier · caps    │
│     client override? (badge)                                                   │
├───────────────────────────────────────────────────────────────────────────────┤
│  2. Governance                                                                 │
│     • operator rule match? → rule chip (name, priority) → link to rule page   │
│     • client override present? → chip                                          │
│     • effective decisionSource, shadowedSource                                 │
│     when this stage produces a pin, stages 3–4 are shown COLLAPSED with a     │
│     "bypassed by <source>" note; user can expand to see what autopilot        │
│     WOULD have chosen                                                          │
├───────────────────────────────────────────────────────────────────────────────┤
│  3. Candidates                                                                 │
│     one bar per model in the catalog snapshot; ordered as returned;           │
│     each bar shows: providerId:modelId + capability chips + p95 latency +     │
│     context window + reliability score + pricing entry USD/1k                 │
├───────────────────────────────────────────────────────────────────────────────┤
│  4. Filter                                                                     │
│     bars from stage 3 filtered by "included/excluded"; excluded bars stay     │
│     visible but greyed out, labelled with exclusionReason ("capability_missing│
│     : tool_use", "context_exceeded", "latency_ceiling", "quality_tier_low",    │
│     "unhealthy_provider")                                                      │
├───────────────────────────────────────────────────────────────────────────────┤
│  5. Score                                                                      │
│     ranked bar list; each bar segmented into the 5 named factors              │
│     (cost/latency/quality/reliability/capability) with the weight shown as    │
│     the segment width; total score labelled on the right; the winning bar is  │
│     highlighted; ties broken by the deterministic tiebreak → visible label    │
├───────────────────────────────────────────────────────────────────────────────┤
│  6. Execution                                                                  │
│     attempt 0 card: provider:model, latency, tokens, estimated $, actual $,   │
│       errorClass badge, reconciled ✓/✗                                        │
│     ↳ if attempts.length === 2: fallback arrow "transient upstream_5xx →     │
│         next candidate" pointing to attempt 1 card                            │
│     terminal outcome banner: none / terminal_fallback_exhausted / …           │
└───────────────────────────────────────────────────────────────────────────────┘
```

### K.3 Interactions

- **Hover a candidate bar (stage 3–5)** → tooltip with the full `Model` + matched `PricingEntry`.
- **Click a candidate bar** → side sheet showing the exact `CandidateScore.scoreBreakdown` numbers, the `RationaleEntry` items that touched this candidate, and a "why not this one?" explainer built from `exclusionReason` and the deltas vs the winner.
- **Click the "rule chip"** in stage 2 → navigate to `/app/governance/rules/:ruleId` with a highlight anchor.
- **Click the "shadowed" chip** → toast + inline diff showing which client override was ignored.
- **Toggle "with rule / without rule"** on the whole visualization → re-render using the "without rule" replayed decision from the Replay endpoint. Used to answer "did the rule change the outcome?"
- **"Copy CLI"** on the visualizer footer → `lca telemetry replay <eventId>` and `lca route preview --messages-file …` templates.

### K.4 Density and reading order

- On the Request Detail page: full width, all six stages expanded.
- Embedded in list rows (Overview, Routing Explorer): a 60px mini-strip showing only stages 5 and 6 as a color-coded bar. The whole graph opens on click.
- Embedded in the Rule Detail page: stages 3–5 only, comparing "with rule" vs "without rule" side-by-side.
- Embedded in the Replay Console: stages 3–5 in "recorded" and "replayed" columns, with a diff highlight when they disagree.

### K.5 What it must NOT do

- No animated "processing" spinner between stages. The decision is not real-time-computed in the UI; the UI is reading a recorded outcome.
- No "AI recommendations" or generated prose. Every label is either a field name from the schema or a directly-quoted `RationaleEntry.note`.
- No emoji for factor icons.
- No log-scale axes without an explicit toggle.

### K.6 Data contract

The visualizer's single input is:

```ts
interface RoutingDecisionGraphInput {
  event: TelemetryEvent;               // required
  catalogSnapshot?: Model[];           // optional; falls back to candidates in RoutingDecision
  matchedRule?: OperatorRule | null;   // if decision.decisionSource === "operator_rule"
  compareTo?: TelemetryEvent | null;   // for side-by-side (rule impact, replay)
}
```

The `RoutingDecisionGraph` intermediate is a pure function of that input. No I/O, no network calls inside the component.

## L. Provider / Model catalog requirements

- **Providers overview** — cards per provider: healthy state, `consecutive_failures`, `last_probed_at`, number of models, current pricing-snapshot entries. Green/yellow/red status.
- **Provider detail** — health probe history sparkline (derived from telemetry `attempts[].errorClass` timeline for that provider), list of models, table of recent request outcomes.
- **Model detail** — the `Model` shape's static metadata + a "usage last 30 days" panel driven by rollups (`GET /v1/telemetry/rollups?providerId=&modelId=`).
- Every capability, context window, and reliability score is shown as a numeric value pulled from the model object. No stylized abstractions.

## M. Cost analytics requirements

- **Cost Dashboard** (`/app/cost`) — stacked area chart of estimated + actual cost by day for the last 30 days, split by provider (default) or by model (toggle). Data source: `GET /v1/telemetry/rollups?fromDate=&toDate=`.
- **Reconciliation** (`/app/cost/reconciliation`) — big number: current `lca_reconciliation_rate`. Sparkline: rate over the last 24 hours (bucketed from `TelemetryEvent.reconciled` counts). Below: list of the last N events where `reconciled = false`, sorted by `abs(estimated - actual)` descending. Row click → Request Detail.
- **Rollups Explorer** (`/app/cost/rollups`) — table over `telemetry_rollups`: one row per `(rollup_date, provider_id, model_id)`, columns for request count, tokens, estimated cost, actual cost, reconciled rate, error breakdown. Filters and sorts client-side within the fetched range.

Every cost value in the UI must display its pricing-table-version identifier on hover (Principle V — visible even in aggregates). Currency: USD only for MVP, displayed to 6 decimal places when < $1 and to 2 decimal places when ≥ $1; both formats show the raw string on click for audit.

## N. Telemetry explorer requirements

Consolidated into the Routing Explorer (§ J). Additional pieces:

- **Time series view**: same `TelemetryEvent[]` grouped into 1-minute buckets, showing counts and mean latency and estimated cost. Toggle between count / p50 latency / p95 latency / cost.
- **Export**: current filter set + first 500 rows → JSONL download. Uses only fields the backend returns; no client-side augmentation.

## O. Request Detail / attempt chain requirements

The attempts strip on Request Detail is a dedicated component below the Routing Visualizer:

- **Attempt 0 card**: `providerId:modelId`, `errorClass` badge, `latencyMs`, `startedAt → endedAt` timeline segment, `estimatedCostUsd`, `actualCostUsd`, `pricingTableVersionId` chip. If `errorClass !== "none"`, red border.
- **Fallback arrow** (only if `attempts.length === 2`): labelled with the transient error class that triggered it and the phrase "single automatic fallback per FR-033".
- **Attempt 1 card**: same layout, plus a chip stating "next candidate from the same routing decision".
- **Terminal outcome banner**: full width below the two cards. Green when `terminalErrorClass === "none"`, red when `terminal_fallback_exhausted`, orange for any other terminal failure.
- Aggregated totals row: `aggregatedInputTokens`, `aggregatedOutputTokens`, `totalLatencyMs` (wall-clock; explicitly labelled to distinguish from sum-of-attempts).

## P. Replay requirements

Replay Console (`/app/traffic/replay/:eventId`) hits `GET /v1/telemetry/replay/{eventId}`.

Layout:

- Header: event ID + a large "Replay does not call any provider" badge (FR-022 audit gate — highlight because users will ask).
- Two Routing Visualizers side by side: **Recorded** (from `event.routingRationale`) and **Replayed** (from the endpoint's `replayed` field).
- Match banner: green "matches: true" or red "matches: false" with the specific field diff.
- For overrides: banner explaining that override-sourced decisions replay trivially (matches by design) with a link to the operator rule.

Replay is never buttonized as "re-run the request" anywhere — the word "replay" always means "reproduce the recorded decision". Naming discipline matters because users will attempt to use it during incident response.

## Q. Override / rule management requirements

- **Rules list** (`/app/governance/rules`) — table of `OperatorRule`s ordered by priority, columns for id, priority, enabled, match summary (chip list), pin summary. Row click → detail.
- **Rule Detail** — the full rule JSON on the right, a "match preview" panel on the left that lets the operator paste a synthetic normalized request and see (via `POST /v1/routing/preview` and a client-side re-run of `matchesRule`) which of the existing rules would match.
- **Rule editor** — form for the four `match` predicates and the `pin` target. Before Save, the editor:
  1. Validates the form against the ratified zod schema (`operatorRuleInputSchema`).
  2. Runs a **dry-run** using `POST /v1/routing/preview` on a small set of synthetic requests spanning capability and token-range extremes.
  3. Shows the predicted `decisionSource`/`chosenModelId` before-vs-after for each synthetic request.
  4. Only after the operator acknowledges the diff does the Save button light up.
- **Rule Impact Timeline** (`/app/governance/rules/:ruleId#impact`) — a 24-hour view of `TelemetryEvent`s whose `routingRationale.rationale` mentions this rule id, plus per-hour count of shadowed client overrides. Answers "did this rule shift traffic?"
- **Priority conflicts**: when two rules can match the same request, show a warning on both. The frontend does the analysis (rule intersection) — no new backend endpoint required.

Client override management is not a separate page — clients send overrides at request time via the API. The UI's role for client overrides is post-hoc: showing them in Request Detail, highlighting when they were shadowed, and offering a "reproduce this override via CLI" snippet.

## R. API key management requirements

- **Keys list** (`/app/governance/keys`) — table of `ApiKeyMetadata`: keyId (truncated), clientId, label, createdAt, lastUsedAt (relative), revokedAt (relative or "active").
- **Create key modal** — form (clientId, label), Submit calls `POST /v1/keys`. **The plaintext `secret` is shown exactly once** in a persistent panel that only closes on explicit acknowledgement ("I have copied it"). Two large action buttons: "Copy secret" and "Copy `Authorization: Bearer …` header". The modal also prints a stderr-style hint about shell history (mirrors the CLI behavior).
- **Revoke** — inline action with a confirmation modal. Revocation invalidates the auth cache on the backend within the TTL; the UI adds an in-flight banner "revocation propagated" for 60 seconds.
- **Never** show hashed secrets, verify caches, or Argon2 parameters. Those are backend implementation details.

## S. Health / observability requirements

- **Health** (`/app/observability/health`) — polls `GET /v1/health` every 10 seconds. Renders each check under `checks.*.ok` as a colored row. Adds derived checks the frontend computes from other endpoints: "reconciliation alert inactive", "at least one healthy provider", "at least one recent successful completion".
- **Metrics** (`/app/observability/metrics`) — for MVP, an embedded read-only Prometheus-style panel with the four `lca_*` gauges/counters/histograms hitting `GET /metrics`, plus a prominent link to the operator's Prometheus/Grafana if one is configured (config value; no backend change).
- **Retention** (`/app/observability/retention`) — surfaces the last retention run's outcome from telemetry (rows with `receivedAt < now - 30d` count → alert if > 0). No new endpoint needed for MVP; a future `/v1/retention/status` would plug in cleanly.

## T. Empty / loading / error states

Every page must define all four states explicitly:

- **Empty** — zero data. Show *why* it's empty ("no requests yet", "no rules configured"), a link to the CLI/API way to add one, and the exact curl to fetch the endpoint. Never "Oops, nothing here" copy.
- **Loading** — skeletons that mirror the shape of the eventual content. No spinners on top-level pages. Debounce revalidation to 200 ms to avoid flicker.
- **Fetch error** — inline error banner with (a) the HTTP status, (b) the `error.code` and `error.message` from the API's `ErrorResponse` shape, (c) the correlation ID from the response `x-request-id` header, (d) a "retry" and a "copy curl" button. On 401 → redirect to `/app/settings/self` with a returnTo query.
- **Partial** (some cards loaded, some failed) — degrade gracefully: never block the whole page on a single failed sub-fetch. Show the working parts.

## U. Responsive behavior

Two supported form factors:

- **Desktop (≥ 1280 px)** — full layout with left rail expanded and right rail visible on detail pages.
- **Wide desktop (≥ 1600 px)** — everything the same; Routing Visualizer stages get more horizontal room to lay candidates side-by-side.

Below 1280 px:

- Left rail collapses to icons.
- Right rail becomes a bottom drawer.
- The Routing Visualizer switches to a vertical single-column layout (stages stack instead of extend). Candidate bars become full-width tiles.

Below 768 px (tablet portrait, phone):

- **Supported for read-only inspection only.** Rule editing, key creation, and pricing snapshot management are hidden with a "please use a desktop or the CLI" note. This is a deliberate decision — no compromise UX for governance actions on small screens.
- Routing Visualizer is scrollable vertically with sticky stage labels.

## V. Accessibility requirements

- **WCAG 2.1 AA baseline.**
- Colour is never the sole carrier of information: `decisionSource` badges also carry text, `terminalErrorClass` also carries the enum name, provider health uses text + colour + icon.
- **Keyboard**: every list is arrow-navigable, ⌘K opens the command palette, `?` shows keyboard shortcut cheatsheet, Escape closes modals/drawers.
- **Screen readers**: the Routing Visualizer includes a linearized text alternative under a `role="region" aria-label="routing decision"` container, exposing each stage as a labelled group and each candidate as a labelled bar with its full metadata read out via `aria-describedby`.
- **Focus rings**: visible on every interactive element; no `outline: none` without a replacement.
- **Motion**: respect `prefers-reduced-motion`; the visualizer's inter-stage highlight animation degrades to instant state change.
- **Colour blindness**: the routing lane's factor-segment palette uses hue *and* pattern (dot, hatch, solid, cross) so the 5 factors remain distinguishable.

## W. Visualization requirements (cross-cutting)

- **Time**: always UTC in tooltips and JSON views; local time only in the primary axis label with an explicit "UTC" toggle available in the top bar.
- **Number formatting**: token counts with thousands separators; cost values as documented in § M; latency in ms with 0 decimal places under 100 ms and 1 decimal place from 100 – 1 000 ms.
- **Color**: a semantic palette (green = healthy/reconciled/none-error; amber = degraded/near-threshold; red = unhealthy/error/alert; neutral gray = idle/unknown). No provider-branded colors.
- **Charting library**: not decided here. Requirements: SSR-safe, tree-shakeable, accessible by default, no d3 magic that fights the DOM. Recharts, Visx, or a hand-rolled SVG for the Routing Visualizer are all acceptable — decision belongs in Figma review.
- **Bench-driven latency budget for the UI itself**: no more than 50 ms to hydrate an interactive Routing Visualizer on a fetched event. Measured via a per-component performance mark.

## X. Figma → Figma MCP → frontend implementation workflow

Sequence for landing frontend work after this document is signed off:

1. **Figma design pass**. Design lead (external to this doc) opens Figma and produces:
   - A design system page: colors, type scale, spacing scale, iconography (aligned with § V colour-blindness constraints), badge/chip components, table row, empty/error/loading skeletons.
   - The Overview, Routing Explorer, Request Detail, and Rule Detail screens as high-fidelity mocks.
   - The Routing Decision Visualizer as a **detailed component page** with every state: autopilot, client_override, operator_rule (with shadowed), 2-attempt fallback, terminal_fallback_exhausted, override-rejected 422, empty-catalog case.
   - Explicit annotations mapping every visible field to a backend contract path (e.g., `TelemetryEvent.decisionSource`, `RoutingDecision.candidateRanking[i].scoreBreakdown.total`). This is the primary review artifact for correctness.

2. **Design review with backend**. Walk the Figma file against `contracts/http-api.yaml` and `contracts/telemetry.md`. Reject any UI that requires a backend field that does not exist. Record any newly-required backend fields on a "backend follow-up" list — do NOT invent them client-side.

3. **Figma MCP ingestion**. Use the Figma MCP `/figma-design-to-code` skill to pull node metadata into the workspace. The design tokens and component structure become the source of truth for the design system implementation.

4. **Frontend scaffold PR** (this document does not authorize implementation; the scaffold PR does). Recommended shape when authorized:
   - New workspace package `packages/web` (Vite + React 19 or Next.js 15 — decide in the scaffold PR).
   - `@lca/schemas` (either a re-export from `@lca/core` or `openapi-typescript` generated) providing typed responses.
   - Vitest + Playwright for tests; use the same DB-backed integration harness the backend uses for e2e coverage of the Routing Visualizer.
   - Never introduce a new HTTP endpoint from the frontend side; every gap goes on the backend follow-up list.

5. **Iteration cadence**. Each screen ships behind a route flag. The Routing Decision Visualizer ships first (Overview + Request Detail with placeholders elsewhere). Cost and Governance next. Observability last.

---

## Constitution alignment

- **Principle I (Library-First)** — the frontend consumes `@lca/core` (types) but never bypasses `@lca/api`; every action is an existing HTTP call. No client-side re-implementation of `decideRoute` or reconciliation math except read-only display of stored results.
- **Principle II (CLI + API Parity)** — the frontend is not the only or primary interface. Every action offers a "copy CLI" affordance.
- **Principle IV (Observability)** — the correlation ID is a first-class UI concept, always visible on any request-scoped view.
- **Principle V (Cost Accuracy)** — every cost value in the UI displays its pricing-table-version identifier.
- **Principle VI (Provider Abstraction)** — the UI treats all providers as equals; no vendor-branded UI.
- **Principle VII (Security)** — API-key secrets are shown exactly once, never re-displayed, never in query strings or URLs. No secrets in local storage.
- **Principle VIII (Simplicity)** — no state-management library unless justified in the scaffold PR; the frontend can be a mostly-stateless read model over the HTTP API with per-page fetchers.
- **Principle IX (SemVer)** — the OpenAPI spec is the versioned contract; the frontend imports types from it, so a breaking change to the API is a breaking change to the frontend.
- **Principle X (Performance)** — see the 50 ms hydrate budget in § W.

## Open questions to resolve in Figma review

1. **Framework choice** — Next.js 15 App Router vs Vite + React Router. Both work; SSR needs and Prometheus embed dictate the choice.
2. **Design system** — build in-house, adopt an existing one (e.g., Radix Themes, shadcn/ui), or purchase.
3. **Charting library** — see § W.
4. **Auth flow** — for MVP the UI is a raw API-key holder in memory (never localStorage). A future OIDC login is out of scope; call this out in the doc.
5. **Environment switching** — how do we scope credentials per environment? Multiple keys stored under a scope prefix? Session-only?
6. **Pricing snapshot endpoint** — should we add a `GET /v1/pricing/versions` and `GET /v1/pricing/versions/:versionId` for the Pricing Snapshots pages, or continue inferring from telemetry? (Trade-off: purity of API surface vs. UI convenience. Backend follow-up if we go with the endpoint.)
7. **Trace deep-linking** — the OTel exporter is not required. When configured, what does the "Open trace" button link to? Grafana Tempo? Jaeger? Honeycomb? — driven by env var, not hard-coded.
8. **Command palette provider search** — should it query the API on every keystroke, or maintain a client-side index? For MVP the catalog is small; a client-side index is fine.
9. **Retention "job status" page** — do we ship the diagnostic-only version (§ S) for MVP, or wait for a real backend endpoint?
10. **Multi-window replay** — should the Replay Console support replaying against a *different* pricing table (what-if analysis)? Backend already pins the recorded snapshot; a "what if today's pricing were applied" mode is a natural future feature but out of MVP scope.

## Deliberate non-decisions

- **No `packages/web` created in this pass.** Scaffold PR follows Figma sign-off.
- **No API contract changes here.** Every backend follow-up will be filed as a separate spec.
- **No visual mockups embedded in this document.** Figma is the visual source of truth; this doc is the product/architecture source of truth.
