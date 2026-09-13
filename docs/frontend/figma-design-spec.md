# LLM Cost Autopilot — Figma Design Spec

**Status**: Design-planning brief. No frontend code exists. No `packages/web` scaffolded.

**Purpose**: Define the exact Figma design plan for the LLM Cost Autopilot control plane. Every screen, component, token, and state described here traces to either a live backend field (path cited) or an explicit client-side derivation (also cited).

**Companion doc**: [frontend-architecture.md](./frontend-architecture.md) — product architecture and page inventory. This spec is the visual-design contract; that doc is the product contract.

**Ground-truth references used while writing this spec**:

- Actual routing weights from [packages/core/src/routing/decide.ts](../../packages/core/src/routing/decide.ts): `cost 0.7 / latency 0.1 / quality 0.05 / reliability 0.1 / capability 0.05`. `qualityTier` order `low=0, standard=0.6, high=1`. Latency score `1 / (1 + p95Ms/200)`.
- Actual exclusion-reason strings from [packages/core/src/evaluation/evaluate.ts](../../packages/core/src/evaluation/evaluate.ts): `"missing required capability: <cap>"`, `"context window N < estimated tokens M"`, `"published p95 latency Xms exceeds ceiling Yms"`, `"quality tier X below required Y"`.
- Actual routes from [packages/api/src/routes/](../../packages/api/src/routes/): 14 endpoints total, enumerated in the Frontend Architecture doc's § F.
- Actual domain types from [packages/core/src/types/](../../packages/core/src/types/): `TelemetryEvent`, `RoutingDecision`, `CandidateScore`, `Attempt`, `Model`, `OperatorRule`, `ApiKeyMetadata`, `TelemetryRollup`, etc.

**Design intent**: this is a control plane for an AI infrastructure product. Not a generic SaaS admin dashboard. Density, clarity, and rigor over decoration. See § 0 for the visual anti-patterns to avoid.

---

## 0. Design intent — the vibe check

**Reference feel**: closer to Cloudflare Workers dashboard, Vercel observability, Grafana Explore, or the AWS Console (in its serious tabs), and less like a Notion template or a generic B2B SaaS admin.

**Explicit anti-patterns to reject in every Figma review**:

- Rounded, drop-shadowed "card grids" as the primary layout mechanism.
- KPI tiles with meaningless deltas (`↑ 12%`) and no context.
- Marketing-style hero sections on internal tools.
- Emoji or illustrated mascots in the product surface.
- Gradient backgrounds behind data tables.
- Provider vendor logos treated as brand elements — they are just badges.
- Chart junk: 3D bars, unnecessary axes, decorative gridlines.
- Sparklines used as decoration instead of measurement.

**Design leverage points**:

1. **Typography carries hierarchy**, not size-of-card.
2. **The routing lane** (§ 6) is the signature visual. Every screen either leads to it or reads its output.
3. **Correlation IDs and pricing versions** are always visible. Persistent, small, monospaced.
4. **Numbers are honest**: 6 decimal places for tiny costs, thousand separators for tokens, unit labels always present.
5. **Governance is loud**: any decision that was overridden or shadowed is visible before you look for it.

---

## 1. Design system

### 1.1 Typography

Two families:

- **Sans** (`Inter var`, or system UI stack `-apple-system, "Segoe UI", "Helvetica Neue", Arial`): interface labels, headings, body copy.
- **Mono** (`JetBrains Mono` or `IBM Plex Mono` or system mono stack): identifiers, timestamps, JSON, curl, keyboard shortcuts, pricing version ids.

Type scale (fixed pixel scale — not a fluid scale, because this is a desktop-first ops tool):

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `text-2xs` | 11 / 14 | 500 | table meta, chip inner text, tooltip labels |
| `text-xs` | 12 / 16 | 500 | table cells, form helper text |
| `text-sm` | 13 / 18 | 500 | body copy, dense info |
| `text-base` | 14 / 20 | 500 | primary body, form inputs |
| `text-md` | 15 / 22 | 500 | section intros |
| `text-lg` | 17 / 24 | 600 | subsection heading |
| `text-xl` | 20 / 28 | 600 | page section heading |
| `text-2xl` | 24 / 32 | 600 | page title |
| `text-3xl` | 32 / 40 | 600 | Overview hero numbers only |
| `text-mono-xs` | 11 / 16 | 400 mono | id chips, timestamps |
| `text-mono-sm` | 12 / 18 | 400 mono | inline code, JSON keys, pricing versions |
| `text-mono-md` | 13 / 20 | 400 mono | JSON view, curl snippets |

Weights used: 400 (mono), 500 (default), 600 (headings). Nothing heavier — no marketing-weight display.

### 1.2 Spacing scale

4-based scale, dense-side:

| Token | px |
|---|---|
| `space-0` | 0 |
| `space-1` | 2 |
| `space-2` | 4 |
| `space-3` | 6 |
| `space-4` | 8 |
| `space-5` | 12 |
| `space-6` | 16 |
| `space-7` | 24 |
| `space-8` | 32 |
| `space-9` | 48 |
| `space-10` | 64 |
| `space-11` | 96 |

Table row min-height: 32 px (dense) with a 40 px "comfortable" toggle. Left rail item: 32 px. Never inject extra vertical padding for decoration.

### 1.3 Border radius

Constrained on purpose — anti-"rounded SaaS":

| Token | px | Use |
|---|---|---|
| `radius-0` | 0 | tables, dividers, page frames |
| `radius-1` | 2 | chips, code inline, tooltips |
| `radius-2` | 4 | buttons, form fields, side sheets |
| `radius-3` | 6 | prominent modals only |

No `radius-full` pills except for the account avatar. No 12–16 px "card" radii anywhere.

### 1.4 Elevation

No drop-shadow chrome on cards. Elevation exists for popovers only:

| Token | Definition | Use |
|---|---|---|
| `elev-0` | none, uses hairline border | all default surfaces |
| `elev-1` | 0 1px 2px rgba(0,0,0,.06), 0 0 0 1px border | dropdowns, tooltips |
| `elev-2` | 0 8px 24px rgba(0,0,0,.14), 0 0 0 1px border | modals, command palette |

Surfaces separate via **1 px hairline border tokens** (`border-subtle`, `border-default`, `border-strong`), not shadow.

### 1.5 Iconography

- **Library**: Lucide (24×24 base, stroked). Alternative: Phosphor thin. Whichever, keep a single family.
- **Sizes**: 12, 14, 16, 20 px only. 12/14 in dense tables; 16 in nav; 20 in section headers.
- **Never**: colored icons for decoration. Icons inherit `currentColor`.

Anti-patterns to reject: outlined-vs-solid mix, hand-drawn illustrations, provider logos placed as icons.

### 1.6 Semantic colors

Palette expresses **state, not brand**. Every color has a role.

**Light theme (default)**

| Token | Hex | Role |
|---|---|---|
| `bg-canvas` | `#FAFAF9` | page background |
| `bg-surface` | `#FFFFFF` | tables, side sheets, modals |
| `bg-inset` | `#F4F4F2` | code blocks, JSON view, KPI hero backgrounds |
| `bg-hover` | `#F1F0EE` | table row hover, nav hover |
| `bg-selected` | `#EEEBFF` | selected table row (subtle) |
| `border-subtle` | `#EDECEA` | inside tables, form dividers |
| `border-default` | `#DCDAD5` | primary surface borders |
| `border-strong` | `#B4B1AB` | focus rings, active tabs |
| `text-primary` | `#1B1B18` | body |
| `text-secondary` | `#57534E` | labels, secondary meta |
| `text-tertiary` | `#8A8680` | timestamps, muted labels |
| `text-inverse` | `#FAFAF9` | on dark accents |
| `accent` | `#4F3AF0` | brand accent (deep indigo — used sparingly; nav active, primary button, focus rings) |
| `accent-soft` | `#EEEBFF` | accent background wash |

**Status semantics — the ops palette**

| Token | Hex | Meaning |
|---|---|---|
| `status-ok` | `#12744C` | healthy, reconciled, terminal=none |
| `status-ok-soft` | `#E4F4EC` | badge background |
| `status-warn` | `#8A5A00` | near threshold, alert clearing, degraded |
| `status-warn-soft` | `#FBF0DA` | badge background |
| `status-err` | `#B4231F` | unhealthy, terminal error, alert active |
| `status-err-soft` | `#FBE5E4` | badge background |
| `status-neutral` | `#57534E` | idle, unknown, disabled |
| `status-info` | `#1F5AA6` | reserved for shadowed / informational badges |

**Chart palette — factor & category encodings**

Two orthogonal chart palettes; never mixed on the same axis.

| Purpose | Tokens | Notes |
|---|---|---|
| Factor breakdown in scoring bar | `factor-cost` `#4F3AF0`, `factor-latency` `#1F5AA6`, `factor-quality` `#7C5FE9`, `factor-reliability` `#0E7C66`, `factor-capability` `#8A5A00` | Weights (0.7 / 0.1 / 0.05 / 0.1 / 0.05) → segment widths. Each factor also gets a pattern (solid / diagonal / dot / horizontal / cross) so color-blind users can distinguish. |
| Categorical provider palette | `cat-1` `#4F3AF0`, `cat-2` `#0E7C66`, `cat-3` `#8A5A00`, `cat-4` `#B4231F`, `cat-5` `#1F5AA6`, `cat-6` `#5C5A55` | Applied deterministically by `hash(providerId) % N` so the same provider always gets the same color across the app. |
| Estimated vs actual cost | `series-est` `#7C5FE9` (dashed line), `series-actual` `#4F3AF0` (solid line) | Estimated is always dashed. |
| Traffic pulse by decisionSource | `ds-autopilot` `#4F3AF0`, `ds-client_override` `#8A5A00`, `ds-operator_rule` `#0E7C66` | Consistent with source-badge colors. |

**Dark theme**

Full-parity dark theme with the same token names, adjusted values:

| Token | Hex |
|---|---|
| `bg-canvas` | `#0E0E0C` |
| `bg-surface` | `#161614` |
| `bg-inset` | `#1D1D1A` |
| `bg-hover` | `#232320` |
| `bg-selected` | `#1F1B36` |
| `border-subtle` | `#26251F` |
| `border-default` | `#302E27` |
| `border-strong` | `#4C4A42` |
| `text-primary` | `#F5F3EE` |
| `text-secondary` | `#B4B1AB` |
| `text-tertiary` | `#807C74` |
| `accent` | `#8B7DF7` |
| `accent-soft` | `#25204A` |
| `status-ok` | `#22C598` |
| `status-warn` | `#F3BF52` |
| `status-err` | `#F26A66` |

**Theme strategy**: dark theme is the **default** for the app shell (matches "dev infrastructure" convention). Light theme is an equally-supported alternative. System-preference detection first, explicit toggle in the account menu, persisted in `localStorage` under `lca.theme`. All Figma screens delivered in both themes.

### 1.7 Motion

- **Duration**: `dur-1` 80 ms (hover / press), `dur-2` 120 ms (small transitions), `dur-3` 200 ms (side sheets, modal open).
- **Easing**: single easing `cubic-bezier(0.16, 1, 0.3, 1)` (natural, non-bouncy).
- **Reduced motion**: all durations collapse to 0 under `prefers-reduced-motion`.
- No parallax, no auto-scroll effects, no animated backgrounds.

---

## 2. Application shell

### 2.1 Top bar (56 px)

Left → right:

1. **Brand / product mark** (32 px logotype, no full name repeated).
2. **Environment indicator**: a chip showing `dev` / `staging` / `prod` with an unmistakable difference. Prod = filled dark chip with a subtle top-of-screen 2 px accent border across the whole app. Dev = outlined chip, orange. This is critical UX — makes it visually impossible to confuse environments.
3. **Global request-ID search**: an inline search field, 480 px wide, monospaced, placeholder `search by request id (UUID) or paste an x-request-id header`. On submit → `/app/traffic/:eventId`.
4. **Reconciliation-alert dot**: solid 8 px dot. Green when `lca_reconciliation_alert_active = 0`; red pulsing when `= 1`. Click → `/app/cost/reconciliation`. Tooltip: current `lca_reconciliation_rate` value.
5. **Provider-health dot**: green when all providers healthy; amber when ≥ 1 unhealthy; red when all unhealthy. Click → `/app/catalog`.
6. **Account menu**: username, active API key label (truncated), "Switch key…", "Theme", "Help", "Sign out". No avatars unless the org has one.

The top bar sits above a 1 px `border-default`. No shadow.

### 2.2 Left rail (240 px expanded / 56 px collapsed)

Two-tier nav:

- Section labels: `Overview`, `Traffic`, `Governance`, `Catalog`, `Cost`, `Observability`. Uppercase 11 px `text-tertiary`.
- Items: 32 px height, 14 px icon + 13 px label. Active state: `accent-soft` bg + 2 px left indicator.
- Footer of the rail: version string (`v0.1.0` monospaced) linking to the deployed image tag; "Docs" link; keyboard shortcut hint (`⌘K`).

### 2.3 Breadcrumbs (36 px)

Only on non-Overview pages. Format: `Section › Sub › Entity (id truncated)`. Last crumb is bold. Never more than 4 levels.

### 2.4 Command palette (⌘K)

Modal, 640 × 480 px, elev-2. Sections in order of frequency:

- **Recent** (last 5 request IDs the user visited).
- **Jump** (routes matching query).
- **Requests** (query is a UUID → offer to open Request Detail).
- **Rules** (fuzzy match on rule id or match summary).
- **Models** (fuzzy match on `provider:model`).
- **Actions** (`Create API key…`, `Add operator rule…`, `Copy last request ID`).

Keyboard-only navigation. Arrow keys move selection. Enter opens. Escape closes.

### 2.5 Global search

The top-bar search is dedicated to **request IDs**. Any non-UUID query redirects to the command palette. Rationale: an ops user pasting a UUID has a single high-value intent; we optimize for that.

### 2.6 Reconciliation-alert banner (only when active)

When `lca_reconciliation_alert_active = 1`, a 40 px banner appears **immediately below the top bar, above all page content**, on every page. Text: `Reconciliation drift active — current rate <X>%, threshold 95%`. Button: "Investigate" → `/app/cost/reconciliation`. Banner uses `status-err-soft` bg and `status-err` left rule.

---

## 3. Overview page (`/app/`)

Not a dashboard. A **status page for the autopilot**. Single scroll column, no side rail.

### 3.1 Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  §1 System readiness strip                                       │
├──────────────────────────────────────────────────────────────────┤
│  §2 Traffic pulse (60 min)          §3 Cost today · Reconciled  │
├──────────────────────────────────────────────────────────────────┤
│  §4 Latest activity (8 rows with mini-visualizer thumbnails)     │
├──────────────────────────────────────────────────────────────────┤
│  §5 Active pricing snapshot                                      │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Metrics

| # | Name | Purpose | Source endpoint | API field(s) | Visualization |
|---|---|---|---|---|---|
| §1.1 | DB reachable | boot-critical | `GET /v1/health` | `checks.db.ok` | 8 px dot + label |
| §1.2 | Active pricing version | boot-critical | `GET /v1/health` | `checks.pricing_active.ok` + `GET /v1/catalog.pricingTableVersionId` | mono chip |
| §1.3 | Healthy providers | routing capability | `GET /v1/catalog` | `models[].providerId` distinct count | `N healthy of M configured` label |
| §1.4 | Reconciliation state | cost trust | `GET /metrics` | `lca_reconciliation_alert_active` gauge | dot + "active"/"clear" |
| §2 | Traffic pulse | throughput + decision-source share | `GET /v1/telemetry/events?since=<now-60m>` | derive counts per 10 s bucket, split by `decisionSource` | stacked area chart, 3 series |
| §3.1 | Cost today | spend visibility | `GET /v1/telemetry/rollups?fromDate=<today>` + `GET /v1/telemetry/events?since=<today-00:00>` | `Σ estimatedCostSumUsd` (rollups if aged) + `Σ estimatedCostUsd` (fresh) | `text-3xl` USD figure + delta vs same time yesterday |
| §3.2 | Reconciled rate now | drift signal | `GET /metrics` | `lca_reconciliation_rate` gauge | gauge widget (0–1, 95% marker) |
| §4 | Latest activity | recency + inspection | `GET /v1/telemetry/events?limit=8` | full events | 8-row table with 60 px mini routing-lane per row |
| §5 | Active pricing snapshot | audit trail | inferred from `TelemetryEvent.pricingTableVersionId` seen in §4 and `GET /v1/catalog.pricingTableVersionId` | `versionId`, `effectiveFrom` | mono chip + link to `/app/catalog/pricing/:versionId` (see Open Q #6) |

### 3.3 Reject list

- No "Welcome, {name}" greeting.
- No unrelated help-video card.
- No tenant/workspace card (single-tenant).

---

## 4. Routing Explorer (`/app/traffic`)

### 4.1 Layout

Two-column: 240 px filter rail on the left; the table takes the rest of the page. No cards — the table starts at the top of the content area.

```
┌────────────┬────────────────────────────────────────────────────┐
│ Filters    │  Toolbar (density, columns, cursor, export)       │
│            ├────────────────────────────────────────────────────┤
│ Time       │  Table                                             │
│ Client     │                                                    │
│ Provider   │                                                    │
│ Model      │                                                    │
│ Source     │                                                    │
│ Error      │                                                    │
│ Reconciled │                                                    │
│ Attempts   │                                                    │
│ Limit      │                                                    │
└────────────┴────────────────────────────────────────────────────┘
```

### 4.2 Filters

Left-rail sections:

- **Time**: presets (5m / 1h / 24h / 7d / custom). Custom opens a small ISO-8601 date-time picker.
- **Client**: autocomplete over recent `clientId` values (client-side).
- **Provider**: multi-select from `GET /v1/catalog`.
- **Model**: dependent on provider selection.
- **Decision source**: 3 checkboxes (`autopilot` / `client_override` / `operator_rule`). Chips use `ds-*` colors.
- **Shadowed source**: toggle "only shadowed".
- **Terminal error class**: 10 checkboxes from `ErrorClass` enum.
- **Reconciled**: tri-state (`✓` / `✗` / `—`).
- **Attempts**: `1` / `2` toggle.
- **Limit**: 25 / 50 / 100 / 200 / 500.

Only Time, Client, Provider, Model, and Limit hit the backend as query params (`since`, `until`, `clientId`, `providerId`, `modelId`, `limit`). Everything else filters client-side over the fetched page.

### 4.3 Search

Not needed on this page — top-bar request-ID search jumps directly to Request Detail.

### 4.4 Table columns

Fixed order, user can hide via toolbar:

| Column | Width | Field | Format |
|---|---|---|---|
| Time | 92 | `receivedAt` | relative (`23s ago`), tooltip absolute UTC |
| Request | 120 | `eventId` | mono, first 8 chars, click-copy full |
| Client | 120 | `clientId` | text, truncated |
| Effective | 220 | `effectiveProviderId` + `effectiveModelId` | `provider` colored chip + `:model` mono |
| Source | 140 | `decisionSource` + `shadowedSource` | source badge, tiny shadowed indicator if present |
| Attempts | 60 | `attempts.length` | 1 or 2 dots; first dot color = `attempts[0].errorClass` |
| Latency | 80 | `totalLatencyMs` | right-aligned ms |
| Est. cost | 100 | `estimatedCostUsd` | right-aligned USD, 6 dp when < $1 |
| Reconciled | 44 | `reconciled` | `✓`/`✗`/`—` |

Row hover reveals a 60 px mini routing-lane inline (stages 5–6 collapsed). Row click → Request Detail.

### 4.5 Toolbar (top of the table area)

Left: total shown / total matched. Middle: cursor controls (`< prev` / `next >` from `nextCursor`). Right: column-visibility menu, density toggle (dense / comfortable), export (JSONL of current page).

---

## 5. Request Detail (`/app/traffic/:eventId`) — PRIMARY design surface

### 5.1 Layout

```
┌────────────────────────────────────────────────────────────────┬────────────┐
│  Header strip                                                   │ Right rail │
│  eventId · receivedAt · clientId · decisionSource · shadowed    │ JSON view  │
│  Correlation strip (x-request-id · trace link · pricing chip)   │            │
├────────────────────────────────────────────────────────────────┤ curl/CLI   │
│  Actions row: [Replay] [Copy curl] [Copy lca cmd] [Open trace]  │ snippets   │
├────────────────────────────────────────────────────────────────┤            │
│                                                                 │            │
│   Routing Decision Visualizer (§6, full-fidelity)               │            │
│                                                                 │            │
├────────────────────────────────────────────────────────────────┤            │
│   Attempts chain (§O)                                           │            │
├────────────────────────────────────────────────────────────────┤            │
│   Cost panel                                                     │            │
├────────────────────────────────────────────────────────────────┤            │
│   Related (linked rule, linked pricing snapshot)                 │            │
└─────────────────────────────────────────────────────────────────┴────────────┘
```

The right rail is 360 px collapsible.

### 5.2 Information hierarchy

Every subsection maps to `TelemetryEvent` fields; nothing invented.

- **Header strip** — `eventId`, `receivedAt` (mono ISO in tooltip; relative on screen), `clientId`, `decisionSource` badge, `shadowedSource` badge (only if non-null).
- **Correlation strip** — `x-request-id` (same value; kept redundant on purpose for ops habit), OTel trace deep-link if `OTEL_EXPORTER_OTLP_ENDPOINT` is configured client-side, `pricingTableVersionId` chip linking to snapshot detail.
- **Actions row** — 4 buttons, one keyboard shortcut per (⇧R replay, ⇧C curl, ⇧L CLI, ⇧T trace).
- **Routing Decision Visualizer** — see § 6.
- **Attempts chain** — see § 5.4.
- **Cost panel** — `estimatedCostUsd`, `actualCostUsd`, `reconciled`, pricing-table version chip. If `reconciled === false`, show the delta `|est − actual|` with the threshold `max($0.001, 5% × actual)` and a link to the reconciliation page.
- **Related** — if `decisionSource === "operator_rule"`, link to the matched rule (id present in the routing rationale note). Always: link to `/app/catalog/pricing/:versionId` for the pinned pricing.

### 5.3 Right rail

Two tabs: **JSON** (pretty-printed raw `TelemetryEvent`) and **CLI** (curl + `lca` snippets). Both are copy-only; no edits.

### 5.4 Attempts chain

Below the visualizer. One card per attempt (max 2). Layout:

```
┌───────────────────────────┐   fallback arrow    ┌───────────────────────────┐
│ Attempt 0                 │ ─── transient ───▶  │ Attempt 1                 │
│ mock-cheap:mock-cheap:sm  │   upstream_5xx      │ mock-fast:mock-fast:def   │
│ [errorClass badge]        │                     │ [errorClass badge]        │
│ 87 ms · 10 → 5 tokens     │                     │ 42 ms · 10 → 5 tokens     │
│ est $0.000001 · actual —  │                     │ est $0.000002 · actual $… │
│ [pricing chip]            │                     │ [pricing chip]            │
└───────────────────────────┘                     └───────────────────────────┘

Terminal outcome banner (full width):
[status-ok] terminal error class: none   ·   aggregatedInputTokens 10   ·   aggregatedOutputTokens 5   ·   totalLatencyMs 132 (wall-clock, not sum)
```

The fallback arrow label always reads `single automatic fallback per FR-033` to teach the contract.

---

## 6. Routing Decision Visualizer — SIGNATURE COMPONENT

This is the reusable custom SVG component. Not a chart-library chart. It renders a **routing lane** for one `TelemetryEvent`. Embedded on 5 surfaces:

- Overview §4 mini-strip (stages 5–6 only)
- Routing Explorer inline hover (stages 5–6)
- Request Detail full (all 6 stages)
- Rule Detail side-by-side (stages 3–5, "with rule" vs "without rule")
- Replay Console side-by-side (all stages, "recorded" vs "replayed")

### 6.1 Data contract

Single pure input:

```ts
interface RoutingDecisionGraphInput {
  event: TelemetryEvent;                 // required
  catalogSnapshot?: Model[] | null;      // optional; falls back to candidates in decision
  matchedRule?: OperatorRule | null;     // if decisionSource === "operator_rule"
  compareTo?: TelemetryEvent | null;     // for side-by-side (rule impact, replay)
  variant: "full" | "mini" | "compare";
}
```

Rendering is a pure function of the input. No fetches inside the component.

### 6.2 Six stages — canonical layout

Full-width horizontal stage bands, 1 px `border-subtle` dividers, stage label sticky at 11 px `text-tertiary` uppercase, stage body flush-left. Vertical rhythm: 12 px pad above/below each stage. No shadow, no card containers around stages.

```
┌─── STAGE 1  REQUEST ──────────────────────────────────────────────────────────
│ req-id (mono)  ·  clientId  ·  estimatedInputTokens: 128  ·  requiredCapabilities: [tool_use, json_mode]
│ requirements: maxLatencyMs ≤ 400  ·  maxCostUsd ≤ $0.02  ·  minQualityTier ≥ standard
│ client override: [providerId: openai, modelId: gpt-4o-mini]         ← only if event.routingRationale reveals override in rationale
├─── STAGE 2  GOVERNANCE ────────────────────────────────────────────────────────
│ operator rule matched? ▶ [rule chip · priority 10 · pin openai:gpt-4o]  → link to rule
│ client override present? ▶ [chip]
│ effective source: [operator_rule badge]     shadowed: [client_override badge]
│ ▸ When this stage produces a pin, stages 3–5 render COLLAPSED with a
│   "bypassed by operator_rule → stages hidden" note. Click "Show what autopilot
│   would have chosen" to expand them from the compareTo replay (if available).
├─── STAGE 3  CANDIDATES ────────────────────────────────────────────────────────
│ [bar] openai:gpt-4o-mini      caps: [tool_use, json_mode]   p95: 1500ms   ctx: 128k   rel: 0.98   price: in $0.15/1k · out $0.60/1k
│ [bar] openai:gpt-4o           caps: [tool_use, json_mode, vision]  p95: 3000ms  ctx: 128k   rel: 0.99   price: in $2.50/1k · out $10/1k
│ [bar] anthropic:claude-3-5-haiku    …
│ [bar] anthropic:claude-3-5-sonnet   …
│ ▸ one horizontal bar per candidate in event.routingRationale.candidateRanking
├─── STAGE 4  FILTER ────────────────────────────────────────────────────────────
│ [bar included] anthropic:claude-3-5-haiku  ✓
│ [bar excluded (dimmed)] openai:gpt-4o-mini  ✗  missing required capability: vision
│ [bar excluded (dimmed)] openai:gpt-4o       ✗  published p95 latency 3000ms exceeds ceiling 400ms
│ [bar excluded (dimmed)] anthropic:claude-3-5-sonnet  ✗  quality tier high below required standard  ← n/a, illustrative
│ ▸ each excluded bar labelled with candidateScore.exclusionReason (verbatim from evaluate.ts)
├─── STAGE 5  SCORE ─────────────────────────────────────────────────────────────
│  cost (0.7)  latency (0.1)  quality (0.05)  reliability (0.1)  capability (0.05)
│ [══════════════════════════════════════][==][=][==][=]   total 0.9124   ← winner (highlighted)
│ [═══════════════════════════][==][=][==][=]              total 0.7810
│ [══════════════════════════][==][=][==][=]               total 0.7530
│ ▸ each segment width = weight × factor score (0..1). All bars share the same
│   x-axis so widths are comparable across candidates.
│ ▸ winner has 2 px accent left rule + accent-soft bg.
│ ▸ tiebreak label appears next to total when two totals are within 1e-9.
├─── STAGE 6  EXECUTION ─────────────────────────────────────────────────────────
│  attempt 0 card   ─(fallback if length===2)▶   attempt 1 card
│  terminal outcome banner
└────────────────────────────────────────────────────────────────────────────────
```

### 6.3 Node & edge inventory (SVG components)

Reusable atoms drawn as SVG (or CSS-styled div, at Figma discretion — kept identical in DOM structure so the linearized a11y tree matches):

- **StageBand** — full-width band with sticky label.
- **CandidateBar** — a horizontal row: `{colorSwatch(providerId)} providerId:modelId {capabilityChip[]} {metadataStrip(p95Ms, contextWindow, reliability, priceIn, priceOut)}`.
- **CandidateBarExcluded** — dimmed CandidateBar with an `✗` and an exclusion-reason label.
- **ScoreBar** — a horizontal bar composed of 5 segments in fixed order (cost / latency / quality / reliability / capability). Segment widths use factor _weight_ (0.7/0.1/0.05/0.1/0.05); segment fill opacity encodes _factor score_ (0..1); segment pattern differentiates factor for color-blind users. Total number rendered on the right.
- **StageEdge** — vertical drop rule between stages (1 px `border-subtle`), with a small triangular caret to indicate flow.
- **GovernanceBadgePair** — two badges: effective source (colored) + shadowed source (subtle info bg).
- **AttemptCard** — the shape in § 5.4.
- **FallbackArrow** — 60 px horizontal arrow with the transient error class label and the fixed subtitle `single automatic fallback per FR-033`.
- **TerminalBanner** — one of {`status-ok`, `status-err`, `status-warn`} full-width strip below the attempts.

### 6.4 States — every one has a documented visual

Every state maps to a real backend condition:

1. **Autopilot (nominal)** — `decisionSource: "autopilot"`, `shadowedSource: null`, `attempts.length === 1`, `terminalErrorClass: "none"`.
2. **Autopilot with fallback** — `attempts.length === 2`, `terminalErrorClass: "none"`. Attempt 0 error class one of `timeout | rate_limit | upstream_5xx`.
3. **Terminal fallback exhausted** — `attempts.length === 2`, `terminalErrorClass: "terminal_fallback_exhausted"`. Both attempt cards red-bordered, terminal banner red.
4. **Client override honored** — `decisionSource: "client_override"`. Stages 3–5 collapsed with expand affordance ("show what autopilot would have chosen").
5. **Operator rule honored** — `decisionSource: "operator_rule"`. Same collapse; stage 2 shows the rule chip prominently.
6. **Operator rule shadows client** — `decisionSource: "operator_rule"`, `shadowedSource: "client_override"`. Stage 2 shows BOTH chips, with the client one visibly struck-through and labelled `shadowed`.
7. **Override rejected before execution** — 422 `override_target_missing`. No stage 5–6; instead a red banner "override target `<id>` is not in the healthy catalog — no provider was called" occupies stages 3–6. Persisted telemetry may or may not exist depending on the request path; Figma must design both.
8. **Context exceeded** — 422 `context_exceeded`. Stages 3–4 render but stage 5 becomes an error banner "no candidate can fit the request within its context window".
9. **All providers unhealthy** — 422 `provider_unavailable`. Stage 3 shows an empty state "no healthy providers" with a link to `/app/observability/health`.
10. **Non-transient upstream failure** — `attempts.length === 1`, `terminalErrorClass` is `upstream_4xx | invalid_request | context_exceeded | override_target_missing | provider_unavailable`. Attempt card red, terminal banner red, explicit "no fallback attempted (non-transient error)".

Each state gets a dedicated Figma frame in file page `06 Request Detail — states`.

### 6.5 Interactions

- **Hover CandidateBar** — soft `bg-hover`; tooltip with the full `Model` object and matched `PricingEntry`.
- **Click CandidateBar** — opens a side sheet (right rail) with `CandidateScore.scoreBreakdown` numbers, applicable `RationaleEntry` notes, and a "why not this one?" delta view vs the winner.
- **Click "rule chip"** in stage 2 — navigate to `/app/governance/rules/:ruleId` with anchor `#matched-by-<eventId>`.
- **Click "shadowed" badge** — toast + inline diff of the client override that was ignored.
- **Toggle "with rule / without rule"** in stage 2 — re-renders stages 3–6 using the `compareTo` replay decision (from `GET /v1/telemetry/replay/:eventId` when the "without rule" hypothetical is derivable) — a fully hypothetical "without rule" replay is not currently derivable from the backend (see Open Q #2); for MVP this toggle is only visible on the Rule Detail dry-run surface where a synthetic `POST /v1/routing/preview` provides the counterfactual.
- **Copy CLI** footer — copies both `lca telemetry replay <eventId>` and a `lca route preview` variant reconstructed from the recorded requirements.
- **Keyboard**: `[` and `]` collapse/expand adjacent stages; `1..6` jump focus to a stage; `enter` opens the focused stage's first interactive element.

### 6.6 Responsive behavior of the visualizer

- **≥ 1280 px**: canonical horizontal-lane layout.
- **1024–1279 px**: stages remain horizontal but candidate metadata strips wrap to two lines; ScoreBar totals move above the bars instead of right-aligned.
- **768–1023 px**: vertical layout — stages stack, each candidate becomes a tile. ScoreBar becomes stacked horizontally with legend to the side.
- **< 768 px**: single-column read-only view with sticky stage headings; hover interactions become tap → side-sheet.

---

## 7. Replay Console (`/app/traffic/replay/:eventId`)

### 7.1 Purpose

Reproduce a stored routing decision from telemetry. The frontend explicitly reinforces that **replay never calls a provider** — this is a common source of user confusion during incidents.

### 7.2 Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Header: eventId · [Replay does not call any provider — read-only]        │
│ Match banner (green ✓ matches / red ✗ diverged, with reason)              │
├──────────────────────────────────────┬───────────────────────────────────┤
│  Recorded routing decision           │  Replayed routing decision         │
│  (from event.routingRationale)       │  (from replay endpoint)            │
│  [Routing Visualizer, variant=compare]│ [Routing Visualizer, variant=compare]│
├──────────────────────────────────────┴───────────────────────────────────┤
│ Field-level diff (only when matches === false)                            │
└──────────────────────────────────────────────────────────────────────────┘
```

### 7.3 Divergence emphasis

When `matches === false`, everything screams:

- Top-level match banner is `status-err-soft` with `status-err` left-rule and 20 px `text-lg` copy: "Replay diverged from the recorded decision".
- The **specific fields that differ** (`chosenProviderId`, `chosenModelId`, or a candidate ranking swap) are wrapped in a `border-strong` dashed outline on both sides.
- A field-level diff table below the two visualizers lists every differing key path (e.g., `chosenModelId: openai:gpt-4o → openai:gpt-4o-mini`).
- Explanation panel guides the operator: "Divergence can happen if the pricing table changed, the catalog changed, or the scoring function changed. Compare `pricingTableVersionId` and `catalog snapshot version` between the two sides."

For override-sourced decisions, the endpoint returns `replayed = recorded` — the console shows an amber "Trivially matches: override decisions are reproduced from the recorded rationale, not re-computed" info banner instead.

### 7.4 Empty / not-found

If the event is outside the 30-day full-fidelity window, show an empty state: "This request is older than the 30-day full-fidelity window. Only rollups are available: `/app/cost/rollups?…`".

---

## 8. Cost Dashboard (`/app/cost`)

### 8.1 Layout

- Header strip: date range picker (default: last 30 days).
- Section 1: **spend over time** — stacked area chart, split by `providerId` (default) or `modelId` (toggle). Data source `GET /v1/telemetry/rollups`. Y-axis shows both estimated (dashed) and actual (solid) as two overlapping series per stack layer.
- Section 2: **top spenders** — a small table: top 10 `(providerId, modelId)` by `estimatedCostSumUsd` over the range.
- Section 3: **reconciliation summary** — the reconciled rate, non-reconciled count, and total absolute drift `|estimated − actual|` over the range. Below: sparkline of reconciled rate.

### 8.2 Fields

Every value maps to `TelemetryRollup.*` fields. The pricing-table-version chip is present on hover for any aggregate — since aggregates cross versions, the tooltip shows the set of versions represented.

### 8.3 Reconciliation page (`/app/cost/reconciliation`)

- Big number: current `lca_reconciliation_rate` (from `/metrics`).
- Gauge widget 0..1 with 95% marker line.
- 24-hour sparkline of reconciled rate.
- List of the last N events where `reconciled === false`, sorted by `|estimated − actual|` descending. Row → Request Detail.
- Threshold formula printed verbatim: `abs(estimated − actual) ≤ max($0.001, 5% × actual)`.
- Window definition printed verbatim: `trailing 60 minutes OR 1,000 most-recent reconcilable requests, whichever closes first`.

### 8.4 Rollups Explorer (`/app/cost/rollups`)

Table over `telemetry_rollups`. One row per `(rollup_date, provider_id, model_id)`. Columns: date, provider, model, request count, tokens (in + out), estimated cost, actual cost, reconciled rate, error breakdown chips (top 3 by count). All numbers derived from `TelemetryRollup` fields verbatim.

---

## 9. Provider / Model catalog

### 9.1 Providers overview (`/app/catalog`)

- Rows (not cards): one provider per row, in a table. Columns: providerId, healthy state (colored dot + text), consecutive failures (from `provider_health_state`; requires a small backend surface — see Open Q #4), last probed relative, model count, active pricing entries count. Row click → provider detail.
- Empty state: "No providers configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY at boot or register a mock via the operations doc."

### 9.2 Provider detail (`/app/catalog/providers/:providerId`)

- Header: providerId (large, mono), healthy chip, last probed at, consecutive failures.
- Health probe history — sparkline derived client-side from telemetry `attempts[].errorClass` filtered to this providerId (last 24 h; requires paginated fetch, documented cost of this derivation in the design).
- Models list — one row per model on this provider, showing `capabilities`, `contextWindow`, `qualityTier`, `publishedLatencyProfile.p95Ms`, `publishedReliabilityScore`, pricing entry from the active snapshot.

### 9.3 Model detail (`/app/catalog/models/:modelId`)

- Static metadata block (full `Model` object).
- Usage last 30 days — from `GET /v1/telemetry/rollups?providerId=&modelId=`: request count, tokens, spend, reconciled rate. Same visualization idioms as the Cost Dashboard.
- Recent requests — 20 most recent events using this model.

### 9.4 Pricing Snapshots (`/app/catalog/pricing`)

Depends on Open Q #6. For MVP without a new endpoint, infer versions from `TelemetryEvent.pricingTableVersionId` distinct values in the last 30 days and from `GET /v1/catalog.pricingTableVersionId` (the current active version). Snapshot detail shows the entries as they existed at that version — derivable only if a snapshot-versions endpoint is added.

Design both the "endpoint-backed" and the "inference-only" variants in Figma so the backend follow-up decision can be made later.

---

## 10. Governance

### 10.1 Operator Rules list (`/app/governance/rules`)

- Rows-in-a-table again: `ruleId` (mono truncated), priority, enabled dot, match summary (chip list: `client:acme-prod`, `caps:tool_use+json_mode`, `tokens:100–800`), pin summary (`provider:model` chip), createdAt, updatedAt. Row → detail.
- "New rule" button opens the rule editor as a full-page route `/app/governance/rules/new`, not a modal — rule creation is a governance action, not a quick edit.

### 10.2 Rule Detail (`/app/governance/rules/:ruleId`)

- Header: ruleId, priority, enabled toggle, created/updated meta.
- Two-column body:
  - Left: rule shape as a form (`priority`, `enabled`, `match` predicates, `pin` target). Read-only until "Edit" is clicked.
  - Right: **Impact preview panel** with a small Routing Visualizer embedded (§ 6, variant=`compare`), rendered from a synthetic request the operator can edit. Shows "with rule" vs "without rule" side-by-side.
- Below: **Impact timeline** — 24-hour count of `TelemetryEvent`s whose `routingRationale.rationale` mentions this rule id, plus count of shadowed client overrides. Bar chart, 1-hour bins.
- Related: linked telemetry events (paginated).

### 10.3 Rule editor — dry-run gate

The workflow this UI enforces on save:

1. Client-side validate against `operatorRuleInputSchema` (zod).
2. **Dry-run** — synthesize a small fixture set (e.g., 4 requests spanning capability and token-range extremes) and call `POST /v1/routing/preview` for each with the proposed rule loaded into a synthetic in-page rule store. Show a before-vs-after `chosenProviderId:chosenModelId` diff per fixture.
3. Only after the operator acknowledges the diff (checkbox: "I have reviewed the impact") does Save become active. Save calls `POST /v1/operator/rules` or `PATCH …`.

Priority-conflict detection is a client-side pass: if the proposed rule's `match` intersects any other enabled rule's `match`, both rules are surfaced with a warning. No new backend endpoint.

### 10.4 Shadowed overrides — how they surface

- Everywhere in the app where `TelemetryEvent.shadowedSource === "client_override"` appears, both the effective source and the shadowed source render as a **paired badge**: effective on the left (colored), shadowed on the right (subtle info bg with strike-through). Hover → "The client requested `<providerId:modelId>` but operator rule `<ruleId>` took precedence."

### 10.5 API Keys (`/app/governance/keys`)

- Rows: keyId (mono truncated), clientId, label, createdAt (relative), lastUsedAt (relative or "never"), status (active / revoked).
- "New key" opens a modal (not full page — quick, transactional).
- Post-creation view: a **persistent panel** that only closes on explicit "I have copied it" acknowledgement. Shows the plaintext `secret` in monospace, plus two copy buttons: "Copy secret" and "Copy `Authorization: Bearer …` header". A stderr-style hint about shell history mirrors the CLI behavior.
- Revoke → confirmation modal → API call → the row transitions to "revoked" with a note "Revocation propagates via the auth-cache TTL (up to 60 s)".

---

## 11. Observability

### 11.1 Health (`/app/observability/health`)

- Polls `GET /v1/health` every 10 s.
- One row per check in `checks.*`. Colored dot + text + detail if `!ok`.
- Below: derived checks the frontend computes (reconciliation alert inactive, at least one healthy provider, at least one recent successful completion). Same visual language.

### 11.2 Metrics (`/app/observability/metrics`)

- Embedded read-only panel for the four `lca_*` series from `/metrics`:
  - `lca_requests_total` (counter, split by labels)
  - `lca_request_duration_seconds` (histogram, p50/p95/p99 lines)
  - `lca_routing_overhead_ms` (histogram, with the constitution's p50/p95/p99 budget markers overlaid)
  - `lca_reconciliation_rate` and `lca_reconciliation_alert_active` (gauges)
- Prominent link-out to the operator's Prometheus/Grafana if `LCA_METRICS_EXTERNAL_URL` is configured (env-driven, not hard-coded).

### 11.3 Retention (`/app/observability/retention`)

Diagnostic-only for MVP: counts events aged beyond 30 days (should be 0), rollups aged beyond 12 months (should be 0). Renders in a small table with the retention window formulas printed for reference.

---

## 12. States — mandatory coverage per screen

Every major screen must specify **all** of these states in Figma:

| State | Definition | Frame naming |
|---|---|---|
| loading | initial data fetch in flight | `<Screen>/loading` |
| empty | fetch succeeded, zero data | `<Screen>/empty` |
| error | fetch failed (non-401) | `<Screen>/error` |
| unauthorized | 401 from backend | `<Screen>/unauthorized` (redirects to settings; still needs the transitional state) |
| no-data | some but not all data present (partial degradation) | `<Screen>/partial` |
| degraded-provider | ≥ 1 provider unhealthy (banner variant of the screen) | `<Screen>/degraded-provider` |
| reconciliation-alert-active | banner variant | `<Screen>/reconciliation-alert` |
| terminal-request-failure | applied to Request Detail specifically | `Request Detail/terminal-failure` |

For the Routing Visualizer, all 10 states in § 6.4 must exist as dedicated frames.

Empty-state copy rule: **explain why it's empty**, cite the exact backend precondition, and offer the CLI equivalent. Never "nothing here yet".

---

## 13. Responsive design

Three breakpoints, each with a dedicated Figma frame set:

- **Desktop wide (≥ 1600 px)** — canonical layout. Routing lane gets full breathing room.
- **Desktop (1280–1599 px)** — canonical layout. Table columns may hide low-priority ones.
- **Compact desktop (1024–1279 px)** — left rail collapses to icons. Right rail becomes a drawer. Routing lane stages wrap. Tables enable horizontal scroll for hidden columns.
- **Tablet (768–1023 px)** — read-only inspection only. Governance edit surfaces are hidden with a "please use a desktop or the CLI" note. Routing lane switches to vertical.
- **Phone (< 768 px)** — same as tablet but scrolled further; only Overview and Request Detail supported as usable read-only surfaces.

---

## 14. Figma file / page structure

Single Figma file: **LLM Cost Autopilot — Control Plane**.

Pages, in strict order:

| # | Page | Contents |
|---|---|---|
| 01 | Foundations | color tokens (light + dark), type scale, spacing scale, radius scale, elevation, iconography demo, motion demo, chart palettes, factor palettes |
| 02 | Components | Button, Input, Select, MultiSelect, Toggle, Chip, Badge, Table (row / header / cell / density), TableToolbar, SideSheet, Modal, Toast, Banner, Tabs, EmptyState, ErrorState, LoadingSkeleton, KeyboardShortcutHint, JsonView, CurlBlock |
| 03 | App Shell | top bar (dev / prod variants), left rail (expanded / collapsed), breadcrumbs, command palette, reconciliation-alert banner, account menu, environment indicator |
| 04 | Overview | canonical layout, all metric widgets, empty state, alert-banner variant |
| 05 | Routing Explorer | filter rail, table (dense / comfortable), inline hover mini-visualizer, empty / loading / error states, cursor pagination |
| 06 | Request Detail | canonical layout, right-rail JSON tab, right-rail CLI tab, all 10 Routing Visualizer states |
| 06.1 | Routing Decision Visualizer | isolated component page — every state × every variant (mini / full / compare) × light + dark |
| 07 | Replay Console | matches / diverged / trivially-matches (override) / not-found (out-of-window) |
| 08 | Cost | dashboard, reconciliation, rollups explorer |
| 09 | Catalog | providers list, provider detail, model detail, pricing snapshots (both endpoint-backed and inference-only variants per Open Q #6) |
| 10 | Governance | rules list, rule detail (impact + timeline), rule editor with dry-run gate, keys list, key create + one-shot secret panel |
| 11 | Observability | health, metrics, retention |
| 99 | Backend contract map | annotations for reviewers — every visible field mapped to a backend path (`TelemetryEvent.decisionSource`, `RoutingDecision.candidateRanking[i].scoreBreakdown.total`, etc.) |

Every page above is delivered in **both light and dark themes**. Both themes are equally supported; dark is the default.

---

## 15. Component strategy

### 15.1 Reusable components (in `02 Components`)

Shared across ≥ 2 pages, worth Figma-component-ification:

- Button (primary / secondary / ghost / danger)
- IconButton
- Input, Textarea, Select, MultiSelect, Toggle, Checkbox, RadioGroup
- DateTimePicker (range)
- Chip (neutral / accent / info / ok / warn / err) — 3 sizes
- Badge (decisionSource variants: autopilot / client_override / operator_rule; ErrorClass variants: 10)
- Table (Header / Row / Cell / DenseRow / ComfortableRow / EmptyRow / SkeletonRow)
- TableToolbar
- SideSheet
- Modal (small / medium / large)
- Toast
- Banner (info / warn / err)
- Tabs
- EmptyState, ErrorState, LoadingSkeleton
- KeyboardShortcutHint
- JsonView (with copy button)
- CurlBlock / CliBlock (with copy button)
- Correlation strip
- Pricing-version chip

### 15.2 Page-specific components (drawn on their page, not componentized)

- Overview traffic-pulse chart
- Reconciliation gauge
- Routing Explorer inline mini-visualizer (a variant of the Routing Visualizer already in `06.1`)
- Attempts chain + Fallback arrow
- Provider health sparkline
- Rule Impact timeline chart

### 15.3 Signature component

The **Routing Decision Visualizer** is a Figma component with variants for state (10) × variant (`full` / `mini` / `compare`) × theme (light / dark). This is the highest-priority Figma artifact; it deserves its own page (`06.1`).

---

## 16. Figma → MCP → Copilot handoff

The exact workflow after design approval:

### 16.1 Design freeze

1. Design lead signals `01 Foundations` and `02 Components` are complete.
2. Cross-review with backend: walk `99 Backend contract map` against `contracts/http-api.yaml` and `data-model.md`. Any field mismatch is either fixed in Figma or filed as a backend follow-up. **No frontend implementation begins with unresolved mismatches.**

### 16.2 MCP ingestion

3. Use the Figma MCP `/figma-design-to-code` skill on `01 Foundations` first — this produces the design tokens (colors, type, spacing, radius) which will seed the frontend package's design-system layer.
4. Ingest `02 Components` next — component structure becomes the seed for the shared UI package's API.
5. Ingest screens (`04` … `11`) as their implementation begins. Do **not** ingest screens ahead of implementation — the MCP output is best used as an active reference during a specific screen's build.

### 16.3 Frontend scaffold (only after § 16.1 is complete and only when explicitly authorized in a subsequent prompt)

When authorized, the scaffold PR follows the plan in [frontend-architecture.md § X](./frontend-architecture.md#x-figma--figma-mcp--frontend-implementation-workflow):

- Create `packages/web` — decision on Next.js 15 vs Vite + React 19 is captured in the scaffold PR.
- Create `@lca/schemas` — either a re-export from `@lca/core` or `openapi-typescript`-generated types from `contracts/http-api.yaml`.
- Introduce a `packages/design-system` for tokens + primitives ingested from Figma.
- Add Vitest + Playwright with the same DB-backed integration harness the backend already uses.
- Every backend gap discovered during implementation is filed as a separate backend spec. No client-side workarounds that assume unimplemented API surface.

### 16.4 Iteration cadence

- **First screen shipped**: Request Detail with the Routing Decision Visualizer.
- **Second**: Overview.
- **Third**: Routing Explorer.
- Governance, Cost, Catalog, and Observability follow.

---

## NO FRONTEND IMPLEMENTATION SHOULD BEGIN UNTIL THE FIGMA SCREENS HAVE BEEN REVIEWED AND APPROVED.

---

## Appendix A — Open design decisions (must resolve in Figma review)

1. **Framework**: Next.js 15 (App Router, SSR) vs Vite + React 19 (SPA). SSR needs and Prometheus embed style dictate the choice.
2. **"Without rule" replay counterfactual**: the backend's replay endpoint currently reproduces the recorded decision as-is; a true "without rule" counterfactual would require a backend change (parameterized preview that ignores the rule store). MVP: expose the "with rule / without rule" toggle only in Rule Detail dry-run (which uses `/v1/routing/preview` with a synthetic rule store), not in Request Detail retrospectively.
3. **Trace deep-link target**: env-driven — Tempo / Jaeger / Honeycomb. Design a single "Open trace →" affordance that hides itself when unconfigured.
4. **Provider health surface**: `provider_health_state.consecutive_failures` and `last_probed_at` are not exposed by any HTTP route today. Either add a `/v1/catalog?includeHealth=true` param (returns unhealthy models too, tagged) or a dedicated `/v1/observability/providers`. Backend follow-up decision needed before Provider detail page is implemented.
5. **Pricing snapshots endpoint**: as covered in Open Q #6 of the architecture doc. Design both the endpoint-backed and inference-only variants; ship the inference-only for MVP if the backend endpoint is not added.
6. **Charting library**: Recharts, Visx, or hand-rolled SVG. The Routing Decision Visualizer is hand-rolled SVG regardless.
7. **Design-system origin**: build in-house, adopt Radix Themes / shadcn/ui, or purchase. Recommendation: hand-rolled tokens (from Figma) with Radix primitives underneath for a11y correctness, no full theme adoption.
8. **Density default**: dense (32 px rows) vs comfortable (40 px). Recommendation: dense default, comfortable available via toolbar toggle. Confirm with Ola persona.
9. **Multi-environment auth**: sessionStorage per environment vs single key that user re-enters. Recommendation: sessionStorage per environment tab, cleared on window close. No localStorage for secrets ever.
10. **Retention diagnostics**: ship the minimal client-derived surface for MVP or wait for a backend endpoint. Recommendation: ship diagnostics-only for MVP, upgrade later.

## Appendix B — Reject list (aesthetics)

- No 12–16 px rounded cards as primary layout mechanism.
- No drop shadows on non-popover surfaces.
- No colored icons for decoration.
- No emoji or illustrated mascots.
- No hero sections on internal pages.
- No gradient backgrounds behind data.
- No arbitrary KPI tiles.
- No AI-generated commentary anywhere.
- No provider vendor logos treated as brand.

---

# Report

## Files inspected

- [docs/frontend/frontend-architecture.md](./frontend-architecture.md)
- [specs/001-llm-routing-mvp/spec.md](../../specs/001-llm-routing-mvp/spec.md)
- [specs/001-llm-routing-mvp/plan.md](../../specs/001-llm-routing-mvp/plan.md)
- [specs/001-llm-routing-mvp/tasks.md](../../specs/001-llm-routing-mvp/tasks.md)
- [specs/001-llm-routing-mvp/data-model.md](../../specs/001-llm-routing-mvp/data-model.md)
- [specs/001-llm-routing-mvp/contracts/http-api.yaml](../../specs/001-llm-routing-mvp/contracts/http-api.yaml)
- [specs/001-llm-routing-mvp/contracts/telemetry.md](../../specs/001-llm-routing-mvp/contracts/telemetry.md)
- [specs/001-llm-routing-mvp/contracts/provider.md](../../specs/001-llm-routing-mvp/contracts/provider.md)
- [specs/001-llm-routing-mvp/contracts/cli.md](../../specs/001-llm-routing-mvp/contracts/cli.md)
- [packages/core/src/routing/decide.ts](../../packages/core/src/routing/decide.ts)
- [packages/core/src/routing/execute-with-fallback.ts](../../packages/core/src/routing/execute-with-fallback.ts)
- [packages/core/src/evaluation/evaluate.ts](../../packages/core/src/evaluation/evaluate.ts)
- [packages/core/src/types/*.ts](../../packages/core/src/types/)
- [packages/api/src/routes/*.ts](../../packages/api/src/routes/)

## Backend fields verified

- **Score weights in `decide.ts`** — verified: `{cost: 0.7, latency: 0.1, quality: 0.05, reliability: 0.1, capability: 0.05}`. Quality tier order `{low: 0, standard: 0.6, high: 1}`. Latency score `1 / (1 + p95Ms / 200)`. Capability score binary (1 if all required present, else 0). Reliability score = `model.publishedReliabilityScore`.
- **Exclusion reasons in `evaluate.ts`** — verified verbatim: `missing required capability: <cap>`, `context window <N> < estimated tokens <M>`, `published p95 latency <X>ms exceeds ceiling <Y>ms`, `quality tier <X> below required <Y>`.
- **Attempts chain contract** — verified: length ≤ 2 for MVP; fallback only on `timeout | rate_limit | upstream_5xx`; not on override-forced decisions; terminal error class `terminal_fallback_exhausted` when both fail; `attempts[i].attemptIndex` set correctly.
- **API surface** — verified 14 routes across 8 route files; all endpoints cited in this spec exist.

## Design decisions made (fixed)

- Type scale: 12 tokens from 11 px to 32 px, sans (Inter) + mono (JetBrains Mono).
- Spacing scale: 4-based, dense-first, 12 tokens.
- Radius: constrained to 0/2/4/6 — no 12–16 px "card" radii.
- Elevation: none on cards, only on popovers/modals.
- Semantic colors: light + dark parity, ops palette for status, factor-specific + categorical chart palettes.
- Dark theme is the default.
- Environment indicator: prominent top-bar chip + 2 px accent border across the app in production.
- Table density: dense default (32 px rows).
- Routing Decision Visualizer: hand-rolled SVG, single pure-function input, 6-stage horizontal lane, 10 documented states, side-by-side compare variant.
- Rule editor requires a dry-run acknowledgement before Save.
- API key secrets shown exactly once, in a persistent panel with an "I have copied it" gate.

## Unresolved design decisions

All 10 items in Appendix A must be resolved during Figma review. The most consequential three:

1. Provider health surface (backend follow-up decision — impacts Provider detail).
2. "Without rule" counterfactual scope (backend follow-up decision — impacts Rule Detail).
3. Framework choice (Next.js vs Vite) — impacts scaffold PR shape.

## Proposed Figma file structure

Single file, 12 pages: `01 Foundations`, `02 Components`, `03 App Shell`, `04 Overview`, `05 Routing Explorer`, `06 Request Detail`, `06.1 Routing Decision Visualizer`, `07 Replay Console`, `08 Cost`, `09 Catalog`, `10 Governance`, `11 Observability`, plus `99 Backend contract map`. Every page delivered in both light and dark themes. See § 14.

## Proposed first three screens to design

Sequence chosen to unblock implementation on the signature product surface first:

1. **`06.1 Routing Decision Visualizer`** — all 10 states × 3 variants × 2 themes. Signature product experience; nothing else can be reviewed until this is right.
2. **`06 Request Detail`** — canonical placement of the visualizer, plus attempts chain, cost panel, and right-rail JSON/CLI tabs.
3. **`04 Overview`** — the persona-facing entry point that uses the visualizer as a mini-strip.

After these three, `05 Routing Explorer` and `07 Replay Console` should follow (both directly consume the visualizer), then Governance, Cost, Catalog, and Observability.

## Explicit confirmation

**No frontend code has been written. No `packages/web` scaffolded. No dependencies installed. No backend code or contract changed. This document is a design plan.**
