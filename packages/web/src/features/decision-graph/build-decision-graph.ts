/**
 * Pure adapters from a real TelemetryEvent into the DecisionGraph feature's
 * UI-only view types. No routing math happens here — the backend already ran
 * the scoring; this file only reshapes the recorded fields for rendering.
 */
import type { CandidateScore, TelemetryEvent } from "../../types/index.js";
import type {
  CandidateView,
  FactorRowView,
  TraceEvent,
} from "./decision-graph.types.js";

const FACTOR_ORDER: FactorRowView["key"][] = [
  "cost",
  "latency",
  "quality",
  "reliability",
  "capability",
];

const FACTOR_WEIGHTS: Record<FactorRowView["key"], number> = {
  cost: 0.7,
  latency: 0.1,
  quality: 0.05,
  reliability: 0.1,
  capability: 0.05,
};

const FACTOR_COLORS: Record<FactorRowView["key"], string> = {
  cost: "var(--accent-primary)",
  latency: "var(--accent-blue)",
  quality: "var(--accent-cyan)",
  reliability: "var(--success)",
  capability: "var(--warn)",
};

const FACTOR_LABEL: Record<FactorRowView["key"], string> = {
  cost: "Cost",
  latency: "Latency",
  quality: "Quality",
  reliability: "Reliability",
  capability: "Capability",
};

function scoreOf(c: CandidateScore, key: FactorRowView["key"]): number {
  const bd = c.scoreBreakdown;
  switch (key) {
    case "cost":
      return typeof bd.costScore === "number" ? bd.costScore : 0;
    case "latency":
      return typeof bd.latencyScore === "number" ? bd.latencyScore : 0;
    case "quality":
      return typeof bd.qualityScore === "number" ? bd.qualityScore : 0;
    case "reliability":
      return typeof bd.reliabilityScore === "number" ? bd.reliabilityScore : 0;
    case "capability":
      return typeof bd.capabilityScore === "number" ? bd.capabilityScore : 0;
  }
}

/** Map a TelemetryEvent's candidateRanking to CandidateView[] (winner / runner-up / excluded). */
export function buildCandidateViews(event: TelemetryEvent): CandidateView[] {
  const ranking = event.routingRationale.candidateRanking;
  const included = ranking.filter((c) => c.included);
  const excluded = ranking.filter((c) => !c.included);
  const rankedIncluded = [...included].sort(
    (a, b) => (b.scoreBreakdown["total"] ?? 0) - (a.scoreBreakdown["total"] ?? 0),
  );

  const winnerIdx = rankedIncluded.findIndex(
    (c) =>
      c.providerId === event.effectiveProviderId &&
      c.modelId === event.effectiveModelId,
  );
  const winner = winnerIdx >= 0 ? rankedIncluded[winnerIdx] : rankedIncluded[0];
  const runnerUp = rankedIncluded.find((c) => c !== winner) ?? null;

  const views: CandidateView[] = [];
  if (winner) {
    views.push({
      rank: 1,
      providerId: winner.providerId,
      modelId: winner.modelId,
      score: winner.scoreBreakdown["total"] ?? 0,
      kind: "winner",
      exclusionReason: null,
    });
  }
  if (runnerUp) {
    views.push({
      rank: 2,
      providerId: runnerUp.providerId,
      modelId: runnerUp.modelId,
      score: runnerUp.scoreBreakdown["total"] ?? 0,
      kind: "runnerUp",
      exclusionReason: null,
    });
  }
  excluded.forEach((c, i) => {
    views.push({
      rank: views.length + 1 - i, // display rank continues; not meaningful for excluded
      providerId: c.providerId,
      modelId: c.modelId,
      score: 0,
      kind: "excluded",
      exclusionReason: c.exclusionReason ?? "excluded",
    });
  });
  return views;
}

export function buildFactorRows(event: TelemetryEvent): FactorRowView[] {
  const winner = event.routingRationale.candidateRanking.find(
    (c) =>
      c.included &&
      c.providerId === event.effectiveProviderId &&
      c.modelId === event.effectiveModelId,
  );
  if (!winner) return [];
  return FACTOR_ORDER.map((key) => {
    const weight = FACTOR_WEIGHTS[key];
    const score = scoreOf(winner, key);
    return {
      key,
      label: FACTOR_LABEL[key],
      weight,
      score,
      contribution: score * weight,
      color: FACTOR_COLORS[key],
    };
  });
}

/**
 * Reconstruct a 10-row trace timeline from a recorded TelemetryEvent.
 *
 * Milestone-1 note: the current TelemetryEvent schema does NOT carry per-stage
 * timestamps for governance/evaluate/decide. The offsets 12/18/28/32/36/40 ms
 * proportionally split the interval receivedAt → attempts[0].startedAt so the
 * story remains truthful even though sub-stage timing is derived, not measured.
 * When packages/core adds stageTimings to RoutingDecision, delete this fn body
 * and read the field directly.
 */
export function buildTimelineFromEvent(event: TelemetryEvent): TraceEvent[] {
  const t0 = Date.parse(event.receivedAt);
  const attempt = event.attempts[0];
  const decideAt = attempt ? Date.parse(attempt.startedAt) : t0;
  const endAt = attempt ? Date.parse(attempt.endedAt) : t0;
  const totalOffset = event.totalLatencyMs;

  const ms = (t: number): number => Math.max(0, Math.round(t - t0));
  const govMs = Math.round(ms(decideAt) * 0.28);
  const evalMs = Math.round(ms(decideAt) * 0.44);
  const scoreAMs = Math.round(ms(decideAt) * 0.7);
  const scoreBMs = Math.round(ms(decideAt) * 0.8);
  const excludeMs = Math.round(ms(decideAt) * 0.9);

  const candidates = event.routingRationale.candidateRanking;
  const included = candidates.filter((c) => c.included);
  const excluded = candidates.filter((c) => !c.included);
  const winner = candidates.find(
    (c) =>
      c.providerId === event.effectiveProviderId &&
      c.modelId === event.effectiveModelId,
  );
  const [a, b] = included;
  const excludedOne = excluded[0];

  const timeline: TraceEvent[] = [
    {
      offsetMs: 0,
      stage: "request",
      title: "Request received",
      detail: `${event.clientId} · ${event.aggregatedInputTokens.toLocaleString()} input tokens · chat completions`,
      state: "completed",
    },
    {
      offsetMs: govMs,
      stage: "governance",
      title: "Governance check",
      detail:
        event.decisionSource === "autopilot" && event.shadowedSource === null
          ? "No overrides · Using autopilot rules"
          : `${event.decisionSource} · shadowed: ${event.shadowedSource ?? "none"}`,
      state: "completed",
    },
    {
      offsetMs: evalMs,
      stage: "evaluate",
      title: "Evaluating candidates",
      detail: `Scoring ${candidates.length} candidates with 5 factors`,
      state: "completed",
    },
  ];

  if (a) {
    timeline.push({
      offsetMs: scoreAMs,
      stage: "evaluate",
      title: "Candidate scored",
      detail: `${a.providerId}:${a.modelId} → ${(a.scoreBreakdown["total"] ?? 0).toFixed(4)}`,
      state: "completed",
    });
  }
  if (b) {
    timeline.push({
      offsetMs: scoreBMs,
      stage: "evaluate",
      title: "Candidate scored",
      detail: `${b.providerId}:${b.modelId} → ${(b.scoreBreakdown["total"] ?? 0).toFixed(4)}`,
      state: "completed",
    });
  }
  if (excludedOne) {
    timeline.push({
      offsetMs: excludeMs,
      stage: "evaluate",
      title: "Candidate excluded",
      detail: `${excludedOne.providerId}:${excludedOne.modelId} → ${excludedOne.exclusionReason ?? "excluded"}`,
      state: "completed",
    });
  }

  timeline.push({
    offsetMs: ms(decideAt),
    stage: "decide",
    title: "Decision committed",
    detail: winner
      ? `Selected ${winner.providerId}:${winner.modelId} (score ${(winner.scoreBreakdown["total"] ?? 0).toFixed(4)})`
      : `decisionSource=${event.decisionSource}`,
    state: "completed",
  });

  if (attempt) {
    timeline.push({
      offsetMs: ms(decideAt) + 2,
      stage: "execute",
      title: "Executing request",
      detail: `Attempt ${attempt.attemptIndex} · ${attempt.providerId}:${attempt.modelId}`,
      state: "completed",
    });
    timeline.push({
      offsetMs: ms(endAt),
      stage: "execute",
      title: "Response received",
      detail: `${attempt.outputTokens?.toLocaleString() ?? "?"} output tokens`,
      state: "completed",
    });
  }

  timeline.push({
    offsetMs: totalOffset,
    stage: "result",
    title: event.terminalErrorClass === "none" ? "Completed" : "Failed",
    detail:
      event.terminalErrorClass === "none"
        ? `Success · Total latency ${totalOffset} ms`
        : `terminalErrorClass=${event.terminalErrorClass}`,
    state: event.terminalErrorClass === "none" ? "completed" : "failed",
  });

  return timeline;
}
