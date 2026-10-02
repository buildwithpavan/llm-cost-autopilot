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
