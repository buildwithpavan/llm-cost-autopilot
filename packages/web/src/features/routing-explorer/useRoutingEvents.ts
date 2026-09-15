"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TelemetryEvent } from "../../types/index.js";
import { listTelemetryEvents } from "../../lib/api/telemetry.js";
import { ApiCallError } from "../../lib/api/client.js";

/** Filters applied server-side via the real GET /v1/telemetry/events query params. */
export interface ServerFilters {
  clientId?: string;
  modelId?: string;
  providerId?: string;
  since?: string;
}

export type RoutingEventsStatus = "loading" | "ready" | "error";

export interface RoutingEventsResult {
  status: RoutingEventsStatus;
  events: TelemetryEvent[];
  error: string | null;
  pageIndex: number;
  hasNext: boolean;
  hasPrev: boolean;
  next: () => void;
  prev: () => void;
  refresh: () => void;
}

/**
 * Fetches routing events with real cursor pagination. Server-side filters
 * (client/model/provider/time) reset the cursor; a page holds up to `pageSize`
 * events. Forward/back navigation is driven by the API's `nextCursor`.
 */
export function useRoutingEvents({
  filters,
  pageSize = 50,
  apiKey,
}: {
  filters: ServerFilters;
  pageSize?: number;
  apiKey?: string;
}): RoutingEventsResult {
  const filterKey = JSON.stringify(filters);
  const [pageCursors, setPageCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [status, setStatus] = useState<RoutingEventsStatus>("loading");
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset pagination whenever the server-side filters change.
  useEffect(() => {
    setPageCursors([null]);
    setPageIndex(0);
  }, [filterKey]);

  const cursor = pageCursors[pageIndex] ?? null;

  const latestReq = useRef(0);
  useEffect(() => {
    const reqId = ++latestReq.current;
    const ctrl = new AbortController();
    setStatus("loading");
    setError(null);
    (async () => {
      try {
        const res = await listTelemetryEvents({
          limit: pageSize,
          ...(filters.clientId ? { clientId: filters.clientId } : {}),
          ...(filters.modelId ? { modelId: filters.modelId } : {}),
          ...(filters.providerId ? { providerId: filters.providerId } : {}),
          ...(filters.since ? { since: filters.since } : {}),
          ...(cursor ? { cursor } : {}),
          ...(apiKey ? { apiKey } : {}),
          signal: ctrl.signal,
        });
        if (reqId !== latestReq.current) return;
        setEvents(res.events);
        setNextCursor(res.nextCursor ?? null);
        setStatus("ready");
      } catch (err) {
        if (reqId !== latestReq.current) return;
        if ((err as { name?: string })?.name === "AbortError") return;
        const message =
          err instanceof ApiCallError
            ? err.message
            : "Unable to reach the telemetry API.";
        setError(message);
        setStatus("error");
      }
    })();
    return () => {
      ctrl.abort();
    };
  }, [filterKey, cursor, pageSize, apiKey, refreshKey]);

  const next = useCallback(() => {
    setNextCursor((currentNext) => {
      if (!currentNext) return currentNext;
      setPageCursors((prev) => {
        const trimmed = prev.slice(0, pageIndex + 1);
        return [...trimmed, currentNext];
      });
      setPageIndex((i) => i + 1);
      return currentNext;
    });
  }, [pageIndex]);

  const prev = useCallback(() => {
    setPageIndex((i) => Math.max(0, i - 1));
  }, []);

  const refresh = useCallback(() => {
    setPageCursors([null]);
    setPageIndex(0);
    setRefreshKey((k) => k + 1);
  }, []);

  return useMemo(
    () => ({
      status,
      events,
      error,
      pageIndex,
      hasNext: nextCursor != null,
      hasPrev: pageIndex > 0,
      next,
      prev,
      refresh,
    }),
    [status, events, error, pageIndex, nextCursor, next, prev, refresh],
  );
}
