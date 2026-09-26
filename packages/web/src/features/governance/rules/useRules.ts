"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { OperatorRule } from "../../../types/index.js";
import { listRules } from "../../../lib/api/rules.js";
import { getEnvironment } from "../../../lib/env.js";

export type RulesStatus = "loading" | "ready" | "error";

export interface UseRulesResult {
  status: RulesStatus;
  rules: OperatorRule[];
  error: string | null;
  refresh: () => void;
}

/** Fetches operator rules (GET only). Ordering is preserved from the backend. */
export function useRules(): UseRulesResult {
  const env = useMemo(() => getEnvironment(), []);
  const [status, setStatus] = useState<RulesStatus>("loading");
  const [rules, setRules] = useState<OperatorRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reqId = useRef(0);

  useEffect(() => {
    const ctrl = new AbortController();
    const id = ++reqId.current;
    setStatus("loading");
    setError(null);
    listRules({ ...(env.apiKey ? { apiKey: env.apiKey } : {}), signal: ctrl.signal })
      .then((rows) => {
        if (id === reqId.current) {
          setRules(rows);
          setStatus("ready");
        }
      })
      .catch((err) => {
        if (ctrl.signal.aborted || id !== reqId.current) return;
        setError(err instanceof Error ? err.message : "Failed to load operator rules");
        setStatus("error");
      });
    return () => ctrl.abort();
  }, [env, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return { status, rules, error, refresh };
}
