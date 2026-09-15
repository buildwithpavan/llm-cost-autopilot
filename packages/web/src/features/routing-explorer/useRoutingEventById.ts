"use client";
import { useEffect, useState } from "react";
import type { TelemetryEvent } from "../../types/index.js";
import { listTelemetryEvents } from "../../lib/api/telemetry.js";
import { ApiCallError } from "../../lib/api/client.js";

export type EventByIdState =
  | { status: "loading" }
  | { status: "ready"; event: TelemetryEvent }
  | { status: "notFound" }
  | { status: "error"; message: string };

/**
 * Loads a single routing event by id. There is no by-id telemetry endpoint, so
 * we scan a recent page of GET /v1/telemetry/events and match locally.
 */
export function useRoutingEventById(eventId: string, apiKey?: string): EventByIdState {
  const [state, setState] = useState<EventByIdState>({ status: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        const res = await listTelemetryEvents({
          limit: 200,
          ...(apiKey ? { apiKey } : {}),
          signal: ctrl.signal,
        });
        if (cancelled) return;
        const event = res.events.find((e) => e.eventId === eventId);
        setState(event ? { status: "ready", event } : { status: "notFound" });
      } catch (err) {
        if (cancelled) return;
        if ((err as { name?: string })?.name === "AbortError") return;
        const message = err instanceof ApiCallError ? err.message : "Unable to reach the telemetry API.";
        setState({ status: "error", message });
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [eventId, apiKey]);

  return state;
}
