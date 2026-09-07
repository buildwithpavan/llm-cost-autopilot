import { Decimal } from "../cost/decimal.js";
import { isReconciled } from "../cost/reconcile.js";
import type {
  Attempt,
  ErrorClass,
  RoutingDecision,
  TelemetryEvent,
} from "../types/telemetry.js";

const TRANSIENT: ReadonlySet<ErrorClass> = new Set([
  "timeout",
  "rate_limit",
  "upstream_5xx",
]);

export interface BuildTelemetryEventInput {
  eventId: string;
  receivedAt: string;
  clientId: string;
  decision: RoutingDecision;
  attempts: readonly Attempt[];
  /** Wall-clock elapsed from ingress to reply. Not the sum of per-attempt latency. */
  totalLatencyMs: number;
}

/**
 * Assemble the persisted TelemetryEvent for a completed request.
 * Enforces the attempts-chain invariants in contracts/telemetry.md.
 */
export function buildTelemetryEvent(input: BuildTelemetryEventInput): TelemetryEvent {
  if (input.attempts.length === 0) {
    throw new Error("buildTelemetryEvent: attempts array is empty");
  }
  if (input.attempts.length > 2) {
    throw new Error(
      `buildTelemetryEvent: MVP attempts chain bound exceeded (got ${input.attempts.length}, max 2)`,
    );
  }
  if (input.attempts.length === 2) {
    const first = input.attempts[0]!;
    if (!TRANSIENT.has(first.errorClass)) {
      throw new Error(
        `buildTelemetryEvent: fallback attempt requires a transient first-attempt error (got ${first.errorClass})`,
      );
    }
  }

  const terminal = input.attempts[input.attempts.length - 1]!;
  const first = input.attempts[0]!;
  const effectiveProviderId = terminal.errorClass === "none"
    ? terminal.providerId
    : first.providerId;
  const effectiveModelId = terminal.errorClass === "none"
    ? terminal.modelId
    : first.modelId;

  const successful = input.attempts.filter((a) => a.errorClass === "none");
  const aggregatedInputTokens = successful.reduce(
    (sum, a) => sum + (a.inputTokens ?? 0),
    0,
  );
  const aggregatedOutputTokens = successful.reduce(
    (sum, a) => sum + (a.outputTokens ?? 0),
    0,
  );

  let estimated = new Decimal("0");
  for (const a of input.attempts) {
    estimated = estimated.plus(a.estimatedCostUsd);
  }

  const allHaveActual = input.attempts.every((a) => a.actualCostUsd !== null);
  const anyHasActual = input.attempts.some((a) => a.actualCostUsd !== null);
  let actualCostUsd: string | null = null;
  if (anyHasActual && allHaveActual) {
    let actual = new Decimal("0");
    for (const a of input.attempts) {
      actual = actual.plus(a.actualCostUsd as string);
    }
    actualCostUsd = actual.toFixed(6).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  }

  const estimatedCostUsd = estimated
    .toFixed(6)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");

  const reconciled =
    actualCostUsd !== null
      ? isReconciled({ estimatedUsd: estimatedCostUsd, actualUsd: actualCostUsd })
      : null;

  return {
    eventId: input.eventId,
    receivedAt: input.receivedAt,
    clientId: input.clientId,
    decisionSource: input.decision.decisionSource,
    shadowedSource: input.decision.shadowedSource,
    effectiveProviderId,
    effectiveModelId,
    attempts: [...input.attempts],
    aggregatedInputTokens,
    aggregatedOutputTokens,
    totalLatencyMs: input.totalLatencyMs,
    terminalErrorClass: terminal.errorClass,
    estimatedCostUsd,
    actualCostUsd,
    pricingTableVersionId: input.decision.pricingTableVersionId,
    reconciled,
    routingRationale: input.decision,
  };
}
