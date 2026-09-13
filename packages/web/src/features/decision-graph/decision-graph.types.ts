/**
 * UI-only intermediate types. Nothing here belongs in the backend schema —
 * these types describe how the DecisionGraph feature RENDERS a TelemetryEvent.
 */

export type Stage = "request" | "governance" | "evaluate" | "decide" | "execute" | "result";
export type StageState = "idle" | "active" | "completed" | "failed";
export type EdgeState =
  | "idle"
  | "active"
  | "completed"
  | "excluded"
  | "fallback"
  | "failed";

export type CandidateKind = "winner" | "runnerUp" | "excluded";

export interface CandidateView {
  rank: number;
  providerId: string;
  modelId: string;
  score: number;
  kind: CandidateKind;
  exclusionReason: string | null;
}

export interface TraceEvent {
  offsetMs: number;
  stage: Stage;
  title: string;
  detail: string;
  state: StageState;
}

export interface FactorRowView {
  key: "cost" | "latency" | "quality" | "reliability" | "capability";
  label: string;
  weight: number;
  score: number;
  contribution: number;
  color: string;
}
