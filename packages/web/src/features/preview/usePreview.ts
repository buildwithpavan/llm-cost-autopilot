"use client";
import { useCallback, useMemo, useRef, useState } from "react";

import { postRoutingPreview, type RoutingPreviewRequest } from "../../lib/api/preview.js";
import { ApiCallError } from "../../lib/api/client.js";
import { getEnvironment } from "../../lib/env.js";
import type { RoutingDecision } from "../../types/index.js";

export type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; decision: RoutingDecision };

export interface UsePreviewResult {
  state: PreviewState;
  submit: (request: RoutingPreviewRequest) => void;
  reset: () => void;
}

/** Submits explicit routing-preview requests. No auto-submit, no persistence. */
export function usePreview(): UsePreviewResult {
  const env = useMemo(() => getEnvironment(), []);
  const [state, setState] = useState<PreviewState>({ status: "idle" });
  const reqId = useRef(0);
  const inFlight = useRef(false);

  const submit = useCallback(
    (request: RoutingPreviewRequest) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const id = ++reqId.current;
      const ctrl = new AbortController();
      setState({ status: "loading" });
      postRoutingPreview(request, { ...(env.apiKey ? { apiKey: env.apiKey } : {}), signal: ctrl.signal })
        .then((decision) => {
          if (id === reqId.current) setState({ status: "ready", decision });
        })
        .catch((err) => {
          if (id !== reqId.current) return;
          setState({ status: "error", message: previewErrorText(err) });
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

  return { state, submit, reset };
}

function previewErrorText(err: unknown): string {
  if (err instanceof ApiCallError) {
    if (err.status === 422) return err.message || "No route could be produced for this request.";
    if (err.status === 400) return err.message || "The request was rejected as invalid.";
    if (err.status === 401) return "Not authorized — check your API key.";
    return err.message;
  }
  return err instanceof Error ? err.message : "Preview request failed";
}
