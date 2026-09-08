import type {
  Attempt,
  ErrorClass,
  NormalizedRequest,
  PricingTable,
  RoutingDecision,
} from "../types/index.js";

const TRANSIENT: ReadonlySet<ErrorClass> = new Set([
  "timeout",
  "rate_limit",
  "upstream_5xx",
]);

export interface ExecuteWithFallbackInput {
  readonly request: NormalizedRequest;
  readonly decision: RoutingDecision;
  readonly pricingTable: PricingTable;
  readonly execute: ExecuteFn;
}

export interface ExecuteFnInput {
  readonly providerId: string;
  readonly modelId: string;
  readonly attemptIndex: number;
}

export interface ExecuteFnSuccess {
  readonly kind: "success";
  readonly content: string;
  readonly finishReason: string;
  readonly attempt: Attempt;
}

export interface ExecuteFnFailure {
  readonly kind: "failure";
  readonly attempt: Attempt;
}

export type ExecuteFnResult = ExecuteFnSuccess | ExecuteFnFailure;
export type ExecuteFn = (input: ExecuteFnInput) => Promise<ExecuteFnResult>;

export interface FallbackResult {
  readonly attempts: Attempt[];
  readonly finalResult: ExecuteFnResult;
  readonly terminalErrorClass: ErrorClass;
  readonly content: string | null;
  readonly finishReason: string | null;
}

/**
 * FR-033/FR-034/FR-035 fallback executor.
 *
 * Behavior:
 *  - Executes the chosen candidate; on success returns immediately.
 *  - On transient failure (timeout / rate_limit / upstream_5xx) attempts exactly
 *    one fallback against the next candidate from the same routing decision,
 *    provided the decision came from autopilot (not override) AND a next
 *    candidate exists.
 *  - When both attempts fail, terminalErrorClass = "terminal_fallback_exhausted".
 *  - Chain length is bounded at 2.
 */
export async function executeWithFallback(input: ExecuteWithFallbackInput): Promise<FallbackResult> {
  const first = await input.execute({
    providerId: input.decision.chosenProviderId,
    modelId: input.decision.chosenModelId,
    attemptIndex: 0,
  });
  const firstAttempt: Attempt = { ...first.attempt, attemptIndex: 0 };

  if (first.kind === "success") {
    return {
      attempts: [firstAttempt],
      finalResult: { ...first, attempt: firstAttempt },
      terminalErrorClass: "none",
      content: first.content,
      finishReason: first.finishReason,
    };
  }

  const errorClass = firstAttempt.errorClass;
  const eligibleForFallback =
    input.decision.decisionSource === "autopilot" && TRANSIENT.has(errorClass);

  const next = pickNextCandidate(input.decision);
  if (!eligibleForFallback || !next) {
    return {
      attempts: [firstAttempt],
      finalResult: { ...first, attempt: firstAttempt },
      terminalErrorClass: errorClass,
      content: null,
      finishReason: null,
    };
  }

  const second = await input.execute({
    providerId: next.providerId,
    modelId: next.modelId,
    attemptIndex: 1,
  });
  const secondAttempt: Attempt = { ...second.attempt, attemptIndex: 1 };

  if (second.kind === "success") {
    return {
      attempts: [firstAttempt, secondAttempt],
      finalResult: { ...second, attempt: secondAttempt },
      terminalErrorClass: "none",
      content: second.content,
      finishReason: second.finishReason,
    };
  }

  return {
    attempts: [firstAttempt, secondAttempt],
    finalResult: { ...second, attempt: secondAttempt },
    terminalErrorClass: "terminal_fallback_exhausted",
    content: null,
    finishReason: null,
  };
}

function pickNextCandidate(
  decision: RoutingDecision,
): { providerId: string; modelId: string } | null {
  for (const c of decision.candidateRanking) {
    if (!c.included) continue;
    if (c.providerId === decision.chosenProviderId && c.modelId === decision.chosenModelId) continue;
    return { providerId: c.providerId, modelId: c.modelId };
  }
  return null;
}
