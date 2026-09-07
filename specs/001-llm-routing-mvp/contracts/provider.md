# Provider Adapter Contract

**Feature**: [001-llm-routing-mvp](../spec.md) · **Plan**: [../plan.md](../plan.md)

This document is the canonical contract every provider adapter in `@lca/providers` MUST satisfy. It is the boundary that Principles VI (Provider Abstraction) and I (Library-First) protect: `@lca/core` depends on this interface only, never on a vendor SDK.

## Interface (`@lca/providers/abstraction`)

```ts
import type {
  NormalizedRequest,
  Model,
  ProviderHealthState,
  Attempt,
  PricingTable,
} from "@lca/core";

export interface ProviderAdapter {
  readonly providerId: string;

  /**
   * Static metadata for every model this provider exposes.
   * MUST be pure (no I/O) and deterministic across a process lifetime.
   */
  listModels(): readonly Model[];

  /**
   * Report reachability. MUST have a hard deadline; MUST NOT throw for
   * upstream failures — return an unhealthy state instead.
   */
  probeHealth(signal: AbortSignal): Promise<ProviderHealthState>;

  /**
   * Execute a normalized request against a specific model.
   *
   * The adapter MUST:
   *  - honor the passed `AbortSignal` (returns immediately with a `timeout` error class if triggered)
   *  - translate vendor-specific errors into the canonical `ErrorClass` enum
   *  - populate `inputTokens` and `outputTokens` when the provider reports usage
   *  - never mutate `request`
   *  - never emit secrets, PII, or vendor tokens in the returned `raw` field
   */
  execute(input: ExecuteInput, signal: AbortSignal): Promise<ExecuteResult>;
}

export interface ExecuteInput {
  readonly request: NormalizedRequest;
  readonly modelId: string;
  /** Pricing table pinned at ingress; adapter uses it for cost fields on the result */
  readonly pricingTable: PricingTable;
  /** Wall-clock deadline for this attempt; adapter MUST respect it */
  readonly deadlineAt: string; // RFC 3339
}

export type ExecuteResult =
  | ExecuteResultSuccess
  | ExecuteResultFailure;

export interface ExecuteResultSuccess {
  readonly kind: "success";
  readonly content: string;
  readonly finishReason: string;
  readonly attempt: Attempt; // errorClass = "none"
}

export interface ExecuteResultFailure {
  readonly kind: "failure";
  readonly attempt: Attempt; // errorClass !== "none"
}
```

## Contract test suite

Exported as `providerContractTests(makeAdapter, opts)` from `@lca/providers/contract-tests`. Every adapter package MUST wire it up in its own test file. The suite covers, at minimum:

### C1. Metadata purity

- `listModels()` returns non-empty results.
- Called twice, the results are structurally equal.
- Every returned `Model.providerId === adapter.providerId`.
- Every returned `Model.pricingDescriptorRef` is a non-empty string.

### C2. Health probe

- `probeHealth()` resolves within its passed deadline.
- Returns a `ProviderHealthState` whose `providerId === adapter.providerId`.
- On simulated upstream failure (transport-level), does NOT throw; returns `healthy: false`.

### C3. Successful execute

- Given a mock provider backend or a recorded fixture, `execute()` returns `{ kind: "success" }` with:
  - `attempt.errorClass === "none"`
  - `attempt.latencyMs >= 0`
  - `attempt.inputTokens` and `attempt.outputTokens` present when the fixture reports usage
  - `attempt.estimatedCostUsd` computed from the passed `pricingTable`
  - `attempt.pricingTableVersionId === pricingTable.versionId`

### C4. Error mapping

The suite drives every branch of the `ErrorClass` enum the adapter can plausibly emit and asserts the mapping:

| Simulated upstream behavior | Required `errorClass` |
|-----------------------------|-----------------------|
| Response after deadline expires | `timeout` |
| HTTP 429 or provider-signaled rate limit | `rate_limit` |
| HTTP 5xx | `upstream_5xx` |
| HTTP 4xx (non-429) | `upstream_4xx` |
| Malformed request body rejected by provider | `invalid_request` |
| Request exceeds provider-declared context window | `context_exceeded` |
| Provider unreachable (DNS, connect refused) | `provider_unavailable` |

Adapters MUST NOT emit `override_target_missing`, `terminal_fallback_exhausted`, or `none` outside of the defined cases.

### C5. Determinism of failures

- Given identical `ExecuteInput` and identical simulated upstream behavior, two calls produce structurally equal `attempt.errorClass` and equal `finishReason`. Latency and timestamps may differ.

### C6. No secret leakage

- The suite passes an assertion helper that scans the returned `attempt` object (and any `raw` field the adapter attaches) for the exact API-key value configured for the run. Presence in ANY field fails the test. This asserts FR-023 for adapter output.

### C7. Cost computation

- `attempt.estimatedCostUsd = (inputTokens × entry.unitInputUsdPerToken) + (outputTokens × entry.unitOutputUsdPerToken)` for the pinned `pricingTable`.
- Computed with `decimal.js-light`; the suite uses fixture pricing where the expected result is known to at least 8 decimal places and asserts equality via `Decimal.eq`.

### C8. AbortSignal honored

- When the caller aborts before the upstream call completes, `execute()` returns a failure with `errorClass === "timeout"` within a bounded number of milliseconds.

### C9. Immutability

- `execute()` MUST NOT mutate `input.request`, `input.pricingTable`, or any argument.

### C10. Concurrency (light)

- The suite launches 10 concurrent `execute()` calls against the same adapter instance and asserts that each returns a valid result and that no state cross-contaminates (e.g., wrong `providerId` on any attempt).

## MVP adapters

The following adapters ship in the MVP and MUST pass the suite above:

- `@lca/providers/mock` — deterministic fake used by tests, CI, and local dev without vendor credentials.
- `@lca/providers/openai` — thin wrapper around the `openai` npm package. This is the only file in the repo permitted to `import "openai"`.
- `@lca/providers/anthropic` — thin wrapper around `@anthropic-ai/sdk`. Same permission model.

## Adding a new provider

SC-005 requires this to be a mechanical operation. The exact steps:

1. Create `packages/providers/src/<name>/` and implement `ProviderAdapter`.
2. Create `packages/providers/test/<name>.contract.test.ts` that imports `providerContractTests` and calls it with a factory.
3. Register the adapter in `packages/providers/src/registry.ts`.
4. Add an ESLint scope allowance for the vendor SDK import if applicable.
5. Update `db/seeds/pricing/<date>.json` with the new provider's model pricing entries.

No file in `packages/core/` may be modified as part of adding a provider. A CI check enforces this: PRs that touch `packages/providers/**` but also touch `packages/core/**` require an override label and a written justification per Principle VIII.
