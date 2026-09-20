# Quickstart: LLM Cost Autopilot MVP

**Feature**: [001-llm-routing-mvp](./spec.md) · **Plan**: [plan.md](./plan.md)

This guide walks a developer through validating the MVP end-to-end on a clean checkout. It does not implement the feature; it defines the runnable scenarios that prove the feature works and maps each scenario to spec success criteria.

## Prerequisites

- Node.js 22 LTS (matches constitution)
- npm 10+ (bundled with Node 22)
- Docker Engine 24+ with Compose plugin
- `jq` (used by the Scenario 1–6 `curl` examples; the `lca` CLI paths do not need it)
- Free ports: `8080` (API), `5432` (Postgres)

Detailed dependency versions are pinned in the workspace root `package.json`.

## One-time setup

```bash
git clone https://github.com/buildwithpavan/llm-cost-autopilot.git
cd llm-cost-autopilot
npm install
```

Copy the sample environment file and edit as needed:

```bash
cp .env.example .env
# Set at minimum:
#   DATABASE_URL=postgres://lca:lca@localhost:5432/lca
# (LCA_BOOTSTRAP_ADMIN_KEY is listed in .env.example but is reserved and NOT
#  consumed at runtime today — see "Bootstrap an API key" for how the first
#  key is actually minted.)
# For real-provider tests (optional):
#   OPENAI_API_KEY=sk-...
#   ANTHROPIC_API_KEY=sk-ant-...
```

## Start the stack

```bash
docker compose -f docker/docker-compose.dev.yml up -d postgres
npm run db:migrate          # applies db/migrations/
npm run db:seed             # loads db/seeds/pricing/<date>.json + a Mock provider
npm run build               # builds all workspaces
npm run start:api           # boots @lca/api on :8080
```

Or run everything containerized:

```bash
docker compose -f docker/docker-compose.dev.yml up --build
```

## Bootstrap an API key

Every endpoint except `/v1/health` and `/metrics` requires a Bearer token, and
`POST /v1/keys` (`lca keys create`) is itself authenticated — so the **first**
key must be minted directly against the database. Run this once, after
`npm run build` and `npm run db:seed`:

```bash
DATABASE_URL=postgres://lca:lca@localhost:5432/lca node -e "
import('./packages/persistence/dist/index.js').then(async (p) => {
  const db = p.createDb(p.createPool(process.env.DATABASE_URL));
  const { secret } = await p.createApiKey(db, { clientId: 'dev', label: 'quickstart' });
  console.log(secret);
  await db.destroy();
});
"
# Copy the printed secret — it is never shown again.
export LCA_API_KEY="<printed secret>"
```

With `LCA_API_KEY` exported, mint any further per-client keys through the CLI:

```bash
lca keys create --client-id another-client --label "another" --json
```

## Scenario 1 — Cost-aware routed request (validates User Story 1, SC-004)

A client sends a chat request with two providers configured (`mock-fast`, `mock-cheap`) and observes deterministic selection of the lowest-cost model that satisfies the request's stated ceilings.

```bash
cat > /tmp/msgs.json <<'JSON'
[
  { "role": "system", "content": "You are a helpful assistant." },
  { "role": "user",   "content": "Summarize: The autopilot exists to reduce LLM cost." }
]
JSON

curl -sS -X POST http://localhost:8080/v1/completions \
  -H "Authorization: Bearer $LCA_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -Rn --slurpfile m /tmp/msgs.json '{messages: $m[0]}')" | jq
```

**Expected**:

- HTTP 200
- `providerId` and `modelId` reflect the lowest-cost qualifying candidate
- `decision.decisionSource === "autopilot"`
- `decision.candidateRanking[]` shows every catalog entry with its score breakdown
- Running the exact same command twice returns the same `providerId` / `modelId` (**FR-011 determinism**)

CLI parity:

```bash
lca complete --messages-file /tmp/msgs.json --json
```

## Scenario 2 — Auditable telemetry and replay (User Story 2, SC-001, SC-002, SC-003)

Run the same request, then verify a telemetry event was written and can be replayed to reproduce the routing decision.

```bash
REQ_ID=$(curl -sS -X POST http://localhost:8080/v1/completions \
  -H "Authorization: Bearer $LCA_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -Rn --slurpfile m /tmp/msgs.json '{messages: $m[0]}')" | jq -r '.requestId')

lca telemetry query --limit 1 --json | jq '.events[0] | {eventId, decisionSource, pricingTableVersionId, effectiveProviderId, effectiveModelId, reconciled, terminalErrorClass}'

lca telemetry replay "$REQ_ID" --json | jq '{matches, recorded: .recorded.chosenModelId, replayed: .replayed.chosenModelId}'
```

**Expected**:

- Telemetry event exists for `REQ_ID` with all fields required by FR-020
- `pricingTableVersionId` is a non-empty string matching the active `pricing_tables` row
- Replay returns `matches: true`

## Scenario 3 — Client override honored, invalid override rejected (User Story 3, SC-006)

```bash
# Honored: pin to a valid, healthy target
curl -sS -X POST http://localhost:8080/v1/completions \
  -H "Authorization: Bearer $LCA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}],"override":{"providerId":"mock-cheap","modelId":"mock-cheap:small"}}' \
  | jq '.decision.decisionSource'   # → "client_override"

# Rejected: pin to a target that does not exist
curl -sS -X POST http://localhost:8080/v1/completions \
  -H "Authorization: Bearer $LCA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}],"override":{"providerId":"nope","modelId":"nope:xl"}}' \
  -o /tmp/err.json -w "%{http_code}\n"   # → 422 with error.code=override_target_missing
```

**Expected**:

- Honored request: HTTP 200, `decision.decisionSource === "client_override"`, telemetry records the same
- Rejected request: HTTP 422, `error.code === "override_target_missing"`, no provider call attempted

## Scenario 4 — Operator rule shadows a client override (FR-027, Clarification Q1)

```bash
cat > /tmp/rule.json <<'JSON'
{
  "priority": 10,
  "enabled": true,
  "match": { "clientIds": ["dev"], "requiredCapabilities": null, "minEstimatedTokens": null, "maxEstimatedTokens": null },
  "pin":   { "providerId": "mock-fast", "modelId": null }
}
JSON

lca rules add --file /tmp/rule.json --json
```

Then repeat the "honored" request from Scenario 3.

**Expected**:

- HTTP 200
- Response `decision.decisionSource === "operator_rule"`
- Response `decision.shadowedSource === "client_override"`
- Same fields in the resulting telemetry event

## Scenario 5 — Fallback on transient provider failure (FR-033, FR-034, Clarification Q2)

Configure the Mock provider to fail the first call with `upstream_5xx`, then observe the platform performing exactly one fallback and recording both attempts.

```bash
lca rules delete <rule-id-from-scenario-4>   # remove the pin so autopilot runs

# The mock provider reads this env var at boot for injected failures.
LCA_MOCK_FAIL_FIRST=upstream_5xx npm run start:api    # separate terminal

curl -sS -X POST http://localhost:8080/v1/completions \
  -H "Authorization: Bearer $LCA_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -Rn --slurpfile m /tmp/msgs.json '{messages: $m[0]}')" | jq '.decision.chosenProviderId'
```

Then:

```bash
lca telemetry query --limit 1 --json | jq '.events[0].attempts | length'   # → 2
lca telemetry query --limit 1 --json | jq '.events[0].attempts[0].errorClass'  # → "upstream_5xx"
lca telemetry query --limit 1 --json | jq '.events[0].attempts[1].errorClass'  # → "none"
lca telemetry query --limit 1 --json | jq '.events[0].terminalErrorClass'      # → "none"
```

**Expected**: Response returns successfully via the fallback candidate; single telemetry event contains both attempts in order.

## Scenario 6 — Cost reconciliation and drift alert (SC-008, Clarification Q3)

```bash
lca telemetry query --limit 100 --json | jq '[.events[] | .reconciled] | group_by(.) | map({reconciled: .[0], count: length})'
```

**Expected**:

- Reconciliation flag present on requests where `actualCost` was reported
- Overall reconciled-rate ≥ 95% on the Mock-provider fixture

Metrics endpoint (Prometheus text format):

```bash
curl -sS http://localhost:8080/metrics | grep lca_reconciliation
# Expected metrics:
#   lca_reconciliation_rate            (gauge, 0.0–1.0)
#   lca_reconciliation_alert_active    (gauge, 0 or 1)
```

## Scenario 7 — Performance budgets (SC-007, SC-011)

```bash
npm run bench:overhead     # vitest bench in packages/core; asserts p50 ≤ 20 ms, p95 ≤ 75 ms on the routing pipeline
npm run bench:throughput   # autocannon 60 s sustained @ 100 rps, then 60 s burst @ 500 rps against Mock provider
```

**Expected**:

- Overhead benchmark reports p50 ≤ 20 ms and p95 ≤ 75 ms and exits 0
- Throughput benchmark reports zero telemetry write failures and non-2xx rate = 0
- Reported RSS growth over the burst window stays under 100 MB

## Scenario 8 — Adding a provider requires no core changes (SC-005)

Fresh terminal, then:

```bash
node scripts/scaffold-provider.mjs --name example
```

This scaffolds `packages/providers/src/example/` and a matching contract test. Now:

```bash
git diff --stat packages/core/          # must be empty
npm test -w @lca/providers -- --run
```

**Expected**:

- `git diff` shows no changes under `packages/core/`
- The new adapter's contract test suite runs (and fails until implemented — that's the Test-First loop)

## Scenario 9 — No secret leakage (SC-009)

```bash
# Fuzz test: 1 000 synthetic secret-shaped payloads must not survive redaction.
npx vitest run packages/core/test/redaction.fuzz.test.ts
# End-to-end grep pass: runs the suite with a known secret and greps all output.
node scripts/audit-secrets.mjs
```

**Expected**: Fuzz test passes on 1 000 synthetic secret-shaped payloads; grep over the exported test-run telemetry finds zero secret matches.

## Success-criteria coverage map

| Success Criterion | Validated by scenario |
|-------------------|-----------------------|
| SC-001 | 2 |
| SC-002 | 2 |
| SC-003 | 2 |
| SC-004 | 1 |
| SC-005 | 8 |
| SC-006 | 3 |
| SC-007 | 7 |
| SC-008 | 6 |
| SC-009 | 9 |
| SC-010 | Covered by `packages/core` unit tests (`npm test -w @lca/core -- --run`) that do not import `@lca/api` |
| SC-011 | 7 |

## Notes

- All commands assume the repo root as `cwd`.
- The `lca` CLI in these examples is provided by the `@lca/cli` workspace once built. During development, use `npx tsx packages/cli/src/bin.ts …` instead.
- Real-provider (OpenAI, Anthropic) scenarios are gated behind `RUN_LIVE_PROVIDER_TESTS=1` in CI and skipped locally by default to avoid cost surprises.
