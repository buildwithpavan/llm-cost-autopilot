/**
 * Pure reducer that projects a stream of TelemetryStreamEvents onto the
 * DecisionGraph feature's UI state. Deterministic and independent of React
 * so it is testable with plain vitest.
 */

import type {
  CandidateEvaluatedEvent,
  CandidateExcludedEvent,
  DecisionCommittedEvent,
  EventCompletedEvent,
  ExecutionCompletedEvent,
  ExecutionStartedEvent,
  GovernanceCompletedEvent,
  RequestReceivedEvent,
  ResultCompletedEvent,
  ResultFailedEvent,
  TelemetryStreamEvent,
} from "@lca/core";

import type {
  CandidateView,
  EdgeState,
  Stage,
  StageState,
  TraceEvent,
} from "../decision-graph/decision-graph.types.js";

export type FlowState =
  | "idle"
  | "receiving"
  | "governance"
  | "evaluating"
  | "deciding"
  | "executing"
  | "success"
  | "failed";

export interface EdgeStateMap {
  requestToGovernance: EdgeState;
  governanceToCandidates: EdgeState;
  candidatesToDecision: EdgeState;
  decisionToExecute: EdgeState;
  executeToResult: EdgeState;
  clientToEngine: EdgeState;
  engineToPolicies: EdgeState;
  engineToCatalog: EdgeState;
  engineToCandidates: EdgeState;
  candidatesToExecution: EdgeState;
  executionToResult: EdgeState;
}

export type NodeRuntimeState = "idle" | "active" | "completed" | "error" | "bypassed";

export interface ControlPlaneNodeMap {
  client: NodeRuntimeState;
  engine: NodeRuntimeState;
  policies: NodeRuntimeState;
  catalog: NodeRuntimeState;
  candidates: NodeRuntimeState;
  execution: NodeRuntimeState;
  result: NodeRuntimeState;
}

export interface LiveGraphState {
  flow: FlowState;
  currentStage: Stage;
  eventId: string | null;
  clientId: string | null;
  stages: Record<Stage, StageState>;
  edges: EdgeStateMap;
  nodes: ControlPlaneNodeMap;
  candidates: CandidateView[];
  winnerProviderId: string | null;
  winnerModelId: string | null;
  winnerScore: number | null;
  decisionSource: "autopilot" | "client_override" | "operator_rule" | null;
  shadowedSource: "client_override" | null;
  matchedRuleId: string | null;
  attempts: Array<{
    attemptIndex: number;
    providerId: string;
    modelId: string;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    errorClass: string;
    estimatedCostUsd: string;
    actualCostUsd: string | null;
    startedAt: string;
    endedAt: string;
    pricingTableVersionId: string;
  }>;
  timeline: TraceEvent[];
  timelineOrigin: string | null;
  hasFallback: boolean;
  terminalErrorClass: string | null;
  fullEvent: EventCompletedEvent["event"] | null;
  lastSeq: number;
}

const IDLE_EDGES: EdgeStateMap = {
  requestToGovernance: "idle",
  governanceToCandidates: "idle",
  candidatesToDecision: "idle",
  decisionToExecute: "idle",
  executeToResult: "idle",
  clientToEngine: "idle",
  engineToPolicies: "idle",
  engineToCatalog: "idle",
  engineToCandidates: "idle",
  candidatesToExecution: "idle",
  executionToResult: "idle",
};

const IDLE_NODES: ControlPlaneNodeMap = {
  client: "idle",
  engine: "idle",
  policies: "idle",
  catalog: "idle",
  candidates: "idle",
  execution: "idle",
  result: "idle",
};

export function initialGraphState(): LiveGraphState {
  return {
    flow: "idle",
    currentStage: "request",
    eventId: null,
    clientId: null,
    stages: {
      request: "idle",
      governance: "idle",
      evaluate: "idle",
      decide: "idle",
      execute: "idle",
      result: "idle",
    },
    edges: { ...IDLE_EDGES },
    nodes: { ...IDLE_NODES },
    candidates: [],
    winnerProviderId: null,
    winnerModelId: null,
    winnerScore: null,
    decisionSource: null,
    shadowedSource: null,
    matchedRuleId: null,
    attempts: [],
    timeline: [],
    timelineOrigin: null,
    hasFallback: false,
    terminalErrorClass: null,
    fullEvent: null,
    lastSeq: -1,
  };
}

/**
 * Fold a single TelemetryStreamEvent into the live graph state.
 * Ignores heartbeats, drops out-of-order events, and starts a fresh
 * request whenever a new eventId's request.received arrives.
 */
export function reduce(state: LiveGraphState, event: TelemetryStreamEvent): LiveGraphState {
  if (event.eventType === "stream.hello" || event.eventType === "stream.heartbeat") return state;
  if (event.seq <= state.lastSeq) return state;
  const next: LiveGraphState = { ...state, lastSeq: event.seq };

  switch (event.eventType) {
    case "request.received":
      return applyRequestReceived(next, event);
    case "governance.completed":
      if (state.eventId !== event.eventId) return state;
      return applyGovernanceCompleted(next, event);
    case "candidate.evaluated":
      if (state.eventId !== event.eventId) return state;
      return applyCandidateEvaluated(next, event);
    case "candidate.excluded":
      if (state.eventId !== event.eventId) return state;
      return applyCandidateExcluded(next, event);
    case "decision.committed":
      if (state.eventId !== event.eventId) return state;
      return applyDecisionCommitted(next, event);
    case "execution.started":
      if (state.eventId !== event.eventId) return state;
      return applyExecutionStarted(next, event);
    case "execution.completed":
      if (state.eventId !== event.eventId) return state;
      return applyExecutionCompleted(next, event);
    case "result.completed":
      if (state.eventId !== event.eventId) return state;
      return applyResultCompleted(next, event);
    case "result.failed":
      if (state.eventId !== event.eventId) return state;
      return applyResultFailed(next, event);
    case "event.completed":
      if (state.eventId !== event.eventId) return state;
      return { ...next, fullEvent: event.event };
    default:
      return state;
  }
}

function delta(from: string | null, at: string): number {
  if (!from) return 0;
  const t0 = Date.parse(from);
  const t1 = Date.parse(at);
  if (Number.isNaN(t0) || Number.isNaN(t1)) return 0;
  return Math.max(0, Math.round(t1 - t0));
}

function push(state: LiveGraphState, entry: TraceEvent): LiveGraphState {
  return { ...state, timeline: [...state.timeline, entry] };
}

function applyRequestReceived(state: LiveGraphState, event: RequestReceivedEvent): LiveGraphState {
  const startedState: LiveGraphState = {
    ...initialGraphState(),
    lastSeq: event.seq,
    eventId: event.eventId,
    clientId: event.clientId,
    timelineOrigin: event.timestamp,
    flow: "receiving",
    currentStage: "request",
    stages: {
      request: "active",
      governance: "idle",
      evaluate: "idle",
      decide: "idle",
      execute: "idle",
      result: "idle",
    },
    edges: {
      ...IDLE_EDGES,
      requestToGovernance: "active",
      clientToEngine: "active",
    },
    nodes: { ...IDLE_NODES, client: "active" },
  };
  return push(startedState, {
    offsetMs: 0,
    stage: "request",
    title: "Request received",
    detail: `${event.clientId} · ${event.estimatedInputTokens.toLocaleString()} input tokens · chat completions`,
    state: "active",
  });
}

function applyGovernanceCompleted(
  state: LiveGraphState,
  event: GovernanceCompletedEvent,
): LiveGraphState {
  const isOperatorRule = event.decisionSource === "operator_rule";
  const detail = isOperatorRule
    ? event.shadowedSource === "client_override"
      ? `operator_rule ${event.matchedRuleId ?? ""} · shadowed client_override`.trim()
      : `operator_rule ${event.matchedRuleId ?? ""}`.trim()
    : event.decisionSource === "client_override"
      ? "client_override applied"
      : "No overrides · Using autopilot rules";
  const withStage: LiveGraphState = {
    ...state,
    flow: "governance",
    currentStage: "governance",
    decisionSource: event.decisionSource,
    shadowedSource: event.shadowedSource,
    matchedRuleId: event.matchedRuleId ?? null,
    stages: { ...state.stages, request: "completed", governance: "active" },
    edges: {
      ...state.edges,
      requestToGovernance: "completed",
      governanceToCandidates: "active",
      clientToEngine: "completed",
      engineToPolicies: isOperatorRule ? "active" : "idle",
      engineToCatalog: isOperatorRule ? "idle" : "active",
    },
    nodes: {
      ...state.nodes,
      client: "completed",
      engine: "active",
      policies: isOperatorRule ? "active" : "idle",
      catalog: isOperatorRule ? "bypassed" : "active",
    },
  };
  return push(withStage, {
    offsetMs: delta(state.timelineOrigin, event.timestamp),
    stage: "governance",
    title: "Governance check",
    detail,
    state: "completed",
  });
}

function applyCandidateEvaluated(
  state: LiveGraphState,
  event: CandidateEvaluatedEvent,
): LiveGraphState {
  const c = event.candidate;
  const rank = state.candidates.length + 1;
  const view: CandidateView = {
    rank,
    providerId: c.providerId,
    modelId: c.modelId,
    score: typeof c.scoreBreakdown["total"] === "number" ? c.scoreBreakdown["total"] : 0,
    kind: rank === 1 ? "winner" : "runnerUp",
    exclusionReason: null,
  };
  const withEval: LiveGraphState = {
    ...state,
    flow: "evaluating",
    currentStage: "evaluate",
    stages: { ...state.stages, governance: "completed", evaluate: "active" },
    edges: {
      ...state.edges,
      governanceToCandidates: "completed",
      engineToCandidates: "active",
    },
    nodes: {
      ...state.nodes,
      catalog: state.nodes.catalog === "bypassed" ? "bypassed" : "completed",
      candidates: "active",
    },
    candidates: [...state.candidates, view],
  };
  return push(withEval, {
    offsetMs: delta(state.timelineOrigin, event.timestamp),
    stage: "evaluate",
    title: "Candidate scored",
    detail: `${c.providerId}:${c.modelId} → ${view.score.toFixed(4)}`,
    state: "completed",
  });
}

function applyCandidateExcluded(
  state: LiveGraphState,
  event: CandidateExcludedEvent,
): LiveGraphState {
  const c = event.candidate;
  const view: CandidateView = {
    rank: state.candidates.length + 1,
    providerId: c.providerId,
    modelId: c.modelId,
    score: 0,
    kind: "excluded",
    exclusionReason: c.exclusionReason ?? "excluded",
  };
  const withEx: LiveGraphState = {
    ...state,
    flow: "evaluating",
    stages: { ...state.stages, evaluate: "active" },
    nodes: { ...state.nodes, candidates: "active" },
    candidates: [...state.candidates, view],
  };
  return push(withEx, {
    offsetMs: delta(state.timelineOrigin, event.timestamp),
    stage: "evaluate",
    title: "Candidate excluded",
    detail: `${c.providerId}:${c.modelId} → ${c.exclusionReason ?? "excluded"}`,
    state: "completed",
  });
}

function applyDecisionCommitted(
  state: LiveGraphState,
  event: DecisionCommittedEvent,
): LiveGraphState {
  const d = event.decision;
  const winner = d.candidateRanking.find(
    (c) => c.providerId === d.chosenProviderId && c.modelId === d.chosenModelId,
  );
  const withDecision: LiveGraphState = {
    ...state,
    flow: "deciding",
    currentStage: "decide",
    decisionSource: d.decisionSource,
    shadowedSource: d.shadowedSource,
    winnerProviderId: d.chosenProviderId,
    winnerModelId: d.chosenModelId,
    winnerScore:
      winner && typeof winner.scoreBreakdown["total"] === "number"
        ? winner.scoreBreakdown["total"]
        : null,
    stages: { ...state.stages, evaluate: "completed", decide: "completed" },
    edges: {
      ...state.edges,
      governanceToCandidates: "completed",
      candidatesToDecision: "completed",
      decisionToExecute: "active",
      engineToCandidates: "completed",
    },
    nodes: { ...state.nodes, candidates: "completed", engine: "completed" },
  };
  return push(withDecision, {
    offsetMs: delta(state.timelineOrigin, event.timestamp),
    stage: "decide",
    title: "Decision committed",
    detail: `Selected ${d.chosenProviderId}:${d.chosenModelId}${
      winner && typeof winner.scoreBreakdown["total"] === "number"
        ? ` (score ${(winner.scoreBreakdown["total"] as number).toFixed(4)})`
        : ""
    }`,
    state: "completed",
  });
}

function applyExecutionStarted(
  state: LiveGraphState,
  event: ExecutionStartedEvent,
): LiveGraphState {
  const hasFallback = event.attemptIndex > 0;
  const withExec: LiveGraphState = {
    ...state,
    flow: "executing",
    currentStage: "execute",
    hasFallback: state.hasFallback || hasFallback,
    stages: { ...state.stages, decide: "completed", execute: "active" },
    edges: {
      ...state.edges,
      decisionToExecute: "completed",
      candidatesToExecution: hasFallback ? "fallback" : "active",
    },
    nodes: { ...state.nodes, execution: hasFallback ? "error" : "active" },
  };
  return push(withExec, {
    offsetMs: delta(state.timelineOrigin, event.timestamp),
    stage: "execute",
    title: hasFallback ? "Fallback executing" : "Executing request",
    detail: `Attempt ${event.attemptIndex} · ${event.providerId}:${event.modelId}`,
    state: "active",
  });
}

function applyExecutionCompleted(
  state: LiveGraphState,
  event: ExecutionCompletedEvent,
): LiveGraphState {
  const a = event.attempt;
  const failed = a.errorClass !== "none";
  const withAttempt: LiveGraphState = {
    ...state,
    attempts: [
      ...state.attempts,
      {
        attemptIndex: a.attemptIndex,
        providerId: a.providerId,
        modelId: a.modelId,
        latencyMs: a.latencyMs,
        inputTokens: a.inputTokens,
        outputTokens: a.outputTokens,
        errorClass: a.errorClass,
        estimatedCostUsd: a.estimatedCostUsd,
        actualCostUsd: a.actualCostUsd,
        startedAt: a.startedAt,
        endedAt: a.endedAt,
        pricingTableVersionId: a.pricingTableVersionId,
      },
    ],
    // Attempt 0 failure with fallback pending: mark execution node as error,
    // keep the execute stage active; result node stays idle.
    // Attempt N success: execution -> active (will be completed on result event).
    nodes: {
      ...state.nodes,
      execution: failed ? "error" : "active",
    },
  };
  return push(withAttempt, {
    offsetMs: delta(state.timelineOrigin, event.timestamp),
    stage: "execute",
    title: a.errorClass === "none" ? "Response received" : "Attempt failed",
    detail:
      a.errorClass === "none"
        ? `${a.outputTokens?.toLocaleString() ?? "?"} output tokens`
        : `${a.providerId}:${a.modelId} · errorClass=${a.errorClass}`,
    state: a.errorClass === "none" ? "completed" : "failed",
  });
}

function applyResultCompleted(
  state: LiveGraphState,
  event: ResultCompletedEvent,
): LiveGraphState {
  const withResult: LiveGraphState = {
    ...state,
    flow: "success",
    currentStage: "result",
    stages: { ...state.stages, execute: "completed", result: "completed" },
    edges: {
      ...state.edges,
      executeToResult: "completed",
      candidatesToExecution: "completed",
      executionToResult: "completed",
    },
    nodes: { ...state.nodes, execution: "completed", result: "completed" },
    terminalErrorClass: event.terminalErrorClass,
  };
  return push(withResult, {
    offsetMs: event.totalLatencyMs,
    stage: "result",
    title: "Completed",
    detail: `Success · Total latency ${event.totalLatencyMs} ms`,
    state: "completed",
  });
}

function applyResultFailed(state: LiveGraphState, event: ResultFailedEvent): LiveGraphState {
  const withFailure: LiveGraphState = {
    ...state,
    flow: "failed",
    currentStage: "result",
    stages: { ...state.stages, execute: "completed", result: "failed" },
    edges: {
      ...state.edges,
      executeToResult: "failed",
      executionToResult: "failed",
    },
    nodes: { ...state.nodes, execution: "error", result: "error" },
    terminalErrorClass: event.terminalErrorClass,
  };
  return push(withFailure, {
    offsetMs: event.totalLatencyMs,
    stage: "result",
    title: "Failed",
    detail: `terminalErrorClass=${event.terminalErrorClass}`,
    state: "failed",
  });
}
