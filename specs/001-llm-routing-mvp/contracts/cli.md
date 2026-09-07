# CLI Contract: `lca`

**Feature**: [001-llm-routing-mvp](../spec.md) · **Plan**: [../plan.md](../plan.md) · **HTTP mirror**: [http-api.yaml](./http-api.yaml)

The `lca` CLI (package `@lca/cli`) mirrors every HTTP capability exposed by the `@lca/api` package. Parity is enforced by a contract test that:

1. Loads the OpenAPI spec at [http-api.yaml](./http-api.yaml).
2. Loads the CLI command tree from `packages/cli/src/commands`.
3. Fails the test suite if any documented HTTP path lacks a corresponding CLI command in the table below, and vice versa.

## Global flags

- `--json` — emit JSON on stdout; human-readable text goes to stderr. **Default off.** Required for machine consumption.
- `--config <path>` — override config file location (defaults to `./config/lca.yaml` then `$LCA_CONFIG`).
- `--api-url <url>` — target a remote API instead of the local in-process wiring (default: local in-process).
- `--api-key <token>` — bearer token when `--api-url` is remote.
- `--verbose` / `-v` — increase log level to `debug` on stderr.

Exit codes:

- `0` success
- `1` generic failure
- `2` invalid arguments
- `3` authentication failure
- `4` remote request failed after retries
- `5` unrecoverable local error (config missing, DB unreachable in local mode)

## Command → HTTP mapping

| CLI command | HTTP route | Notes |
|-------------|-----------|-------|
| `lca health` | `GET /v1/health` | Prints ok/degraded; exit 0 when ok, exit 1 when degraded. |
| `lca complete --messages-file <path> [--max-latency-ms N] [--max-cost-usd D] [--min-quality low\|standard\|high] [--capability tool_use,...] [--pin-provider ID] [--pin-model ID]` | `POST /v1/completions` | Reads messages JSON from file (or `-` for stdin). Emits the CompletionResponse. |
| `lca route preview --messages-file <path> [same flags as complete]` | `POST /v1/routing/preview` | Dry-run routing. Never touches a provider. |
| `lca catalog list` | `GET /v1/catalog` | Prints the catalog. |
| `lca telemetry query [--client-id ID] [--provider-id ID] [--model-id ID] [--since RFC3339] [--until RFC3339] [--limit N] [--cursor C]` | `GET /v1/telemetry/events` | Prints events; supports `--json` for automation. |
| `lca telemetry rollups [--provider-id ID] [--model-id ID] [--from YYYY-MM-DD] [--to YYYY-MM-DD]` | `GET /v1/telemetry/rollups` | Prints rollups. |
| `lca telemetry replay <event-id>` | `GET /v1/telemetry/replay/{eventId}` | Prints recorded vs. replayed decision; exits non-zero when they diverge. |
| `lca rules list` | `GET /v1/operator/rules` | |
| `lca rules add --file <path>` | `POST /v1/operator/rules` | Rule payload as JSON in file (or `-` for stdin). |
| `lca rules update <rule-id> --file <path>` | `PATCH /v1/operator/rules/{ruleId}` | |
| `lca rules delete <rule-id>` | `DELETE /v1/operator/rules/{ruleId}` | |
| `lca keys list` | `GET /v1/keys` | |
| `lca keys create --client-id ID --label LABEL` | `POST /v1/keys` | Prints the freshly generated `secret` exactly once to stdout (or JSON with `--json`). Secret never re-appears. |
| `lca keys revoke <key-id>` | `DELETE /v1/keys/{keyId}` | |

## Parity rules (asserted by contract test)

1. Every documented HTTP route in `http-api.yaml` maps to at least one row above.
2. Every row above maps to a defined command tree node in `packages/cli/src/commands`.
3. Every argument in the CLI corresponds to a defined field in the associated OpenAPI schema (or is a global flag).
4. Every CLI command supports `--json` unless it produces no output (e.g., `keys revoke`).

## Output conventions (Principle II)

- Errors go to **stderr** as human-readable text. When `--json` is set, errors are also emitted as a single JSON object on stderr with the same `error.code` / `error.message` shape as the HTTP `ErrorResponse` schema.
- Successful data output goes to **stdout**. When `--json` is set, output is exactly the corresponding OpenAPI schema representation.
- Secrets (bearer tokens, API-key secrets) are printed **only** on `lca keys create`, only once, and never persisted to shell history in any tool we ship (the command emits a hint about `HISTIGNORE` on stderr).
