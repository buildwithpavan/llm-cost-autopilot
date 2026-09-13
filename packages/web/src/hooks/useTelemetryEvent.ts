"use client";
import { useEffect, useState } from "react";
import type { TelemetryEvent } from "../types/index.js";
import { listTelemetryEvents } from "../lib/api/telemetry.js";
import { REFERENCE_EVENT } from "../fixtures/reference-event.js";
import { getEnvironment } from "../lib/env.js";

export type EventQueryState =
  | { status: "loading" }
  | { status: "ready"; event: TelemetryEvent; source: "backend" | "fixture" }
  | { status: "error"; message: string };

/**
 * Milestone-1 policy: try the backend once. If it fails (offline / no data),
 * fall back to the reference fixture so the UI stays visually complete.
 * Never fabricate values that could be mistaken for real telemetry.
 */
export function useTelemetryEvent(): EventQueryState {
  const [state, setState] = useState<EventQueryState>({ status: "loading" });

  useEffect(() => {
    const env = getEnvironment();
    const ctrl = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const res = await listTelemetryEvents({
          limit: 1,
          signal: ctrl.signal,
          ...(env.apiKey ? { apiKey: env.apiKey } : {}),
        });
        if (cancelled) return;
        if (res.events.length > 0 && res.events[0]) {
          setState({ status: "ready", event: res.events[0], source: "backend" });
        } else {
          setState({ status: "ready", event: REFERENCE_EVENT, source: "fixture" });
        }
      } catch (err) {
        if (cancelled) return;
        if ((err as { name?: string })?.name === "AbortError") return;
        setState({ status: "ready", event: REFERENCE_EVENT, source: "fixture" });
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);

  return state;
}
