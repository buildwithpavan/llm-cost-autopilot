"use client";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { TelemetryEvent, TelemetryStreamEvent } from "@lca/core";
import { openTelemetryStream, type StreamConnectionState } from "../lib/sse/connect-stream.js";
import { getEnvironment } from "../lib/env.js";
import {
  initialGraphState,
  reduce,
  type LiveGraphState,
} from "../features/live-graph/graph-reducer.js";

const DEFAULT_STAGE_PACING_MS = 220;
const TERMINAL_HOLD_MS = 600;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Live telemetry stream + graph state. Subscribes to the backend SSE endpoint
 * and folds every incoming TelemetryStreamEvent into the LiveGraphState via
 * the pure reducer.
 *
 * PRESENTATION LAYER: stage events on the mock backend can complete in a few
 * milliseconds, faster than a human can see. This hook queues incoming events
 * and dispatches them with a minimum inter-event gap so state transitions are
 * perceptible. The underlying event timestamps are untouched — pacing only
 * changes when the frontend re-renders, not what it displays. Fully bypassed
 * under prefers-reduced-motion.
 */
export function useLiveEventStream({
  clientId,
  apiKey,
  enabled = true,
  stagePacingMs,
}: {
  clientId?: string;
  apiKey?: string;
  enabled?: boolean;
  stagePacingMs?: number;
} = {}): {
  graph: LiveGraphState;
  connection: StreamConnectionState;
  lastLatest: TelemetryEvent | null;
} {
  const env = useMemo(() => getEnvironment(), []);
  const [graph, dispatch] = useReducer(reduce, undefined, initialGraphState);
  const [connection, setConnection] = useState<StreamConnectionState>("idle");
  const lastLatestRef = useRef<TelemetryEvent | null>(null);
  const [lastLatest, setLastLatest] = useState<TelemetryEvent | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const url = `${env.apiBaseUrl.replace(/\/$/, "")}/v1/telemetry/events/stream`;
    const key = apiKey ?? env.apiKey;
    const reduced = prefersReducedMotion();
    const pacing = reduced ? 0 : (stagePacingMs ?? DEFAULT_STAGE_PACING_MS);

    // Small paced queue so the user can perceive stage transitions on mock
    // backends. Real event timestamps are preserved on the events themselves.
    const queue: TelemetryStreamEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let flushing = false;

    function pump(): void {
      if (flushing) return;
      flushing = true;
      const step = (): void => {
        const next = queue.shift();
        if (!next) {
          flushing = false;
          return;
        }
        dispatch(next);
        if (next.eventType === "event.completed") {
          lastLatestRef.current = next.event;
          setLastLatest(next.event);
        }
        // Longer hold after the terminal frame so viewers can read the final state.
        const gap =
          next.eventType === "result.completed" || next.eventType === "result.failed"
            ? Math.max(pacing, TERMINAL_HOLD_MS)
            : pacing;
        if (queue.length === 0) {
          flushing = false;
          return;
        }
        if (gap === 0) {
          step();
        } else {
          holdTimer = setTimeout(step, gap);
        }
      };
      step();
    }

    const handle = openTelemetryStream({
      url,
      ...(key ? { apiKey: key } : {}),
      ...(clientId ? { clientId } : {}),
      onEvent(event: TelemetryStreamEvent) {
        // Hello + heartbeat: dispatch immediately, don't pace them.
        if (event.eventType === "stream.hello" || event.eventType === "stream.heartbeat") {
          dispatch(event);
          return;
        }
        queue.push(event);
        pump();
      },
      onStateChange(state) {
        setConnection(state);
      },
    });
    return () => {
      handle.close();
      if (timer) clearTimeout(timer);
      if (holdTimer) clearTimeout(holdTimer);
    };
  }, [apiKey, clientId, enabled, env.apiBaseUrl, env.apiKey, stagePacingMs]);

  return { graph, connection, lastLatest };
}
