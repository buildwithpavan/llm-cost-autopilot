import { apiRequest } from "./client.js";

/** One row of GET /v1/budgets/status. All monetary fields are decimal strings. */
export interface BudgetStatusRow {
  budgetId: string;
  scope: "global" | "client";
  clientId: string | null;
  period: "daily" | "rolling_30d";
  action: "block" | "warn";
  limitUsd: string;
  currentSpendUsd: string;
  remainingUsd: string;
  /** currentSpendUsd / limitUsd as a 6-decimal ratio string (backend-computed). */
  utilization: string;
  status: "below_limit" | "at_limit" | "over_limit";
}

export interface BudgetStatusResponse {
  budgets: BudgetStatusRow[];
}

// Mirrors GET /v1/budgets/status. The budget window is backend-defined
// (daily / rolling_30d); no since/until/clientId is sent from the client.
export function getBudgetStatus(
  opts: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<BudgetStatusResponse> {
  const reqOpts: { apiKey?: string; signal?: AbortSignal } = {};
  if (opts.apiKey) reqOpts.apiKey = opts.apiKey;
  if (opts.signal) reqOpts.signal = opts.signal;
  return apiRequest<BudgetStatusResponse>("/v1/budgets/status", reqOpts);
}

/** One per-budget evaluation inside a durable budget decision. Monetary fields are decimal strings. */
export interface BudgetDecisionEvaluation {
  budgetId: string;
  scope: "global" | "client";
  clientId: string | null;
  period: "daily" | "rolling_30d";
  action: "block" | "warn";
  decision: "allow" | "warn" | "block";
  currentSpendUsd: string;
  projectedSpendUsd: string;
  limitUsd: string;
  remainingUsd: string;
}

/** One durable budget decision audit record (warned/blocked only). */
export interface BudgetDecisionRecord {
  eventId: string;
  decidedAt: string;
  clientId: string;
  decision: "warned" | "blocked";
  requestEstimatedCostUsd: string;
  applicableBudgetIds: string[];
  blockedBudgetIds: string[];
  evaluations: BudgetDecisionEvaluation[];
}

export interface BudgetDecisionsResponse {
  decisions: BudgetDecisionRecord[];
}

export interface BudgetDecisionsOptions {
  clientId?: string;
  since?: string;
  until?: string;
  limit?: number;
  apiKey?: string;
  signal?: AbortSignal;
}

// Mirrors GET /v1/telemetry/budget-decisions (clientId/since/until/limit).
export function getBudgetDecisions(
  opts: BudgetDecisionsOptions = {},
): Promise<BudgetDecisionsResponse> {
  const q = new URLSearchParams();
  if (opts.clientId) q.set("clientId", opts.clientId);
  if (opts.since) q.set("since", opts.since);
  if (opts.until) q.set("until", opts.until);
  if (opts.limit !== undefined) q.set("limit", String(opts.limit));
  const search = q.toString();
  const path = `/v1/telemetry/budget-decisions${search ? `?${search}` : ""}`;
  const reqOpts: { apiKey?: string; signal?: AbortSignal } = {};
  if (opts.apiKey) reqOpts.apiKey = opts.apiKey;
  if (opts.signal) reqOpts.signal = opts.signal;
  return apiRequest<BudgetDecisionsResponse>(path, reqOpts);
}
