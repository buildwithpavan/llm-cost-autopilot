import type { OperatorRule } from "../../types/index.js";
import { apiRequest } from "./client.js";

/** GET /v1/operator/rules — returns rules already ordered by priority ascending. */
export function listRules(opts: { apiKey?: string; signal?: AbortSignal } = {}): Promise<OperatorRule[]> {
  const reqOpts: { apiKey?: string; signal?: AbortSignal } = {};
  if (opts.apiKey) reqOpts.apiKey = opts.apiKey;
  if (opts.signal) reqOpts.signal = opts.signal;
  return apiRequest<OperatorRule[]>("/v1/operator/rules", reqOpts);
}
