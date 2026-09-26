"use client";
import { useEffect, useMemo, useState } from "react";

import type { OperatorRule } from "../../../types/index.js";
import { deleteRule, listRules, updateRule } from "../../../lib/api/rules.js";
import { ApiCallError } from "../../../lib/api/client.js";
import { getEnvironment } from "../../../lib/env.js";
import { enabledPatch } from "./rule-mutations.js";

export type RuleDetailState =
  | { status: "loading" }
  | { status: "ready"; rule: OperatorRule }
  | { status: "notFound" }
  | { status: "error"; message: string };

export interface UseRuleResult {
  state: RuleDetailState;
  refresh: () => void;
  /** PATCH { enabled } only; resolves with the server-confirmed rule. */
  setEnabled: (next: boolean) => Promise<OperatorRule>;
  /** Hard delete; resolves on 204. */
  remove: () => Promise<void>;
}

/**
 * Loads a single operator rule by scanning GET /v1/operator/rules and matching
 * locally — there is no by-id backend route. Mutations are server-confirmed.
 */
export function useRule(ruleId: string): UseRuleResult {
  const env = useMemo(() => getEnvironment(), []);
  const apiKey = env.apiKey;
  const [state, setState] = useState<RuleDetailState>({ status: "loading" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    setState({ status: "loading" });
    listRules({ ...(apiKey ? { apiKey } : {}), signal: ctrl.signal })
      .then((rules) => {
        if (cancelled) return;
        const rule = rules.find((r) => r.ruleId === ruleId);
        setState(rule ? { status: "ready", rule } : { status: "notFound" });
      })
      .catch((err) => {
        if (cancelled || ctrl.signal.aborted) return;
        const message = err instanceof ApiCallError ? err.message : "Unable to reach the rules API.";
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [ruleId, apiKey, tick]);

  const refresh = () => setTick((t) => t + 1);

  const setEnabled = async (next: boolean): Promise<OperatorRule> => {
    const updated = await updateRule(ruleId, enabledPatch(next), apiKey ? { apiKey } : {});
    setState({ status: "ready", rule: updated });
    return updated;
  };

  const remove = (): Promise<void> => deleteRule(ruleId, apiKey ? { apiKey } : {});

  return { state, refresh, setEnabled, remove };
}
