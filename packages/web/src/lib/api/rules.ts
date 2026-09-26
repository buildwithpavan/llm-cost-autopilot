import type { OperatorRule, OperatorRuleInput } from "../../types/index.js";
import { apiRequest } from "./client.js";

/** GET /v1/operator/rules — returns rules already ordered by priority ascending. */
export function listRules(opts: { apiKey?: string; signal?: AbortSignal } = {}): Promise<OperatorRule[]> {
  const reqOpts: { apiKey?: string; signal?: AbortSignal } = {};
  if (opts.apiKey) reqOpts.apiKey = opts.apiKey;
  if (opts.signal) reqOpts.signal = opts.signal;
  return apiRequest<OperatorRule[]>("/v1/operator/rules", reqOpts);
}

/** POST /v1/operator/rules — creates a rule; returns the created rule. */
export function createRule(
  input: OperatorRuleInput,
  opts: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<OperatorRule> {
  const reqOpts: { method: "POST"; body: OperatorRuleInput; apiKey?: string; signal?: AbortSignal } = {
    method: "POST",
    body: input,
  };
  if (opts.apiKey) reqOpts.apiKey = opts.apiKey;
  if (opts.signal) reqOpts.signal = opts.signal;
  return apiRequest<OperatorRule>("/v1/operator/rules", reqOpts);
}

/** PATCH /v1/operator/rules/:ruleId — partial update; returns the updated rule. */
export function updateRule(
  ruleId: string,
  input: Partial<OperatorRuleInput>,
  opts: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<OperatorRule> {
  const reqOpts: { method: "PATCH"; body: Partial<OperatorRuleInput>; apiKey?: string; signal?: AbortSignal } = {
    method: "PATCH",
    body: input,
  };
  if (opts.apiKey) reqOpts.apiKey = opts.apiKey;
  if (opts.signal) reqOpts.signal = opts.signal;
  return apiRequest<OperatorRule>(`/v1/operator/rules/${encodeURIComponent(ruleId)}`, reqOpts);
}

/** DELETE /v1/operator/rules/:ruleId — HARD delete (permanent), 204 on success. */
export function deleteRule(ruleId: string, opts: { apiKey?: string; signal?: AbortSignal } = {}): Promise<void> {
  const reqOpts: { method: "DELETE"; apiKey?: string; signal?: AbortSignal } = { method: "DELETE" };
  if (opts.apiKey) reqOpts.apiKey = opts.apiKey;
  if (opts.signal) reqOpts.signal = opts.signal;
  return apiRequest<void>(`/v1/operator/rules/${encodeURIComponent(ruleId)}`, reqOpts);
}
