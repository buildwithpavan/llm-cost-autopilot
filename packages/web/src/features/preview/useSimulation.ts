"use client";
import { useCallback, useMemo, useRef, useState } from "react";

import { postRoutingSimulation, type SimulateRoutingBody, type SimulationResponse } from "../../lib/api/simulate.js";
import { ApiCallError } from "../../lib/api/client.js";
import { getEnvironment } from "../../lib/env.js";

export type SimulationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: SimulationResponse };

export interface UseSimulationResult {
  state: SimulationState;
  run: (body: SimulateRoutingBody) => void;
  reset: () => void;
}

/** Submits explicit governance dry-run simulations. No persistence, no auto-run. */
export function useSimulation(): UseSimulationResult {
  const env = useMemo(() => getEnvironment(), []);
  const [state, setState] = useState<SimulationState>({ status: "idle" });
  const reqId = useRef(0);
  const inFlight = useRef(false);

  const run = useCallback(
    (body: SimulateRoutingBody) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const id = ++reqId.current;
      const ctrl = new AbortController();
      setState({ status: "loading" });
      postRoutingSimulation(body, { ...(env.apiKey ? { apiKey: env.apiKey } : {}), signal: ctrl.signal })
        .then((data) => {
          if (id === reqId.current) setState({ status: "ready", data });
        })
        .catch((err) => {
          if (id === reqId.current) setState({ status: "error", message: simulationErrorText(err) });
        })
        .finally(() => {
          if (id === reqId.current) inFlight.current = false;
        });
    },
    [env],
  );

  const reset = useCallback(() => {
    reqId.current += 1;
    inFlight.current = false;
    setState({ status: "idle" });
  }, []);

  return { state, run, reset };
}

function simulationErrorText(err: unknown): string {
  if (err instanceof ApiCallError) {
    if (err.status === 401) return "Not authorized — check your API key.";
    return err.message || `Simulation failed (${err.status}).`;
  }
  return err instanceof Error ? err.message : "Simulation failed.";
}
