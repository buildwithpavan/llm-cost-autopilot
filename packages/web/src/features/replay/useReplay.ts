"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getReplay, type ReplayResult } from "../../lib/api/replay.js";
import { ApiCallError } from "../../lib/api/client.js";
import { getEnvironment } from "../../lib/env.js";

export type ReplayState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "notFound" }
  | { status: "error"; message: string }
  | { status: "ready"; result: ReplayResult };

export interface UseReplayResult {
  state: ReplayState;
  refresh: () => void;
}

/** Loads a single deterministic replay for the given event (idle when none selected). */
export function useReplay(eventId: string | null): UseReplayResult {
  const env = useMemo(() => getEnvironment(), []);
  const [state, setState] = useState<ReplayState>({ status: eventId ? "loading" : "idle" });
  const [tick, setTick] = useState(0);
  const reqId = useRef(0);

  useEffect(() => {
    if (!eventId) {
      setState({ status: "idle" });
      return;
    }
    const ctrl = new AbortController();
    const id = ++reqId.current;
    setState({ status: "loading" });
    getReplay(eventId, { ...(env.apiKey ? { apiKey: env.apiKey } : {}), signal: ctrl.signal })
      .then((result) => {
        if (id === reqId.current) setState({ status: "ready", result });
      })
      .catch((err) => {
        if (ctrl.signal.aborted || id !== reqId.current) return;
        if (err instanceof ApiCallError && err.status === 404) {
          setState({ status: "notFound" });
          return;
        }
        setState({ status: "error", message: err instanceof Error ? err.message : "Replay failed" });
      });
    return () => ctrl.abort();
  }, [eventId, env, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { state, refresh };
}
