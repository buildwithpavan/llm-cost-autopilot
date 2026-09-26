"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TelemetryEvent } from "../../types/index.js";
import { listTelemetryEvents } from "../../lib/api/telemetry.js";
import { getCatalog, type CatalogResponse } from "../../lib/api/catalog.js";
import { getReconciliationMetrics, type ReconciliationMetrics } from "../../lib/api/metrics.js";
import { getEnvironment } from "../../lib/env.js";
import type { Async } from "../overview/overview-model.js";

export type CostRange = "24h" | "7d" | "30d";

const RANGE_MS: Record<CostRange, number> = {
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};
const RANGE_LABEL: Record<CostRange, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

const PAGE_SIZE = 500;
/** Safety cap: at most MAX_PAGES × PAGE_SIZE events fetched for one window. */
const MAX_PAGES = 10;

export interface CostWindow {
  since: string;
  until: string;
  label: string;
}

export interface CostEventsResult {
  events: TelemetryEvent[];
  /** True when the safety cap stopped pagination before the window was exhausted. */
  truncated: boolean;
}

export interface UseCostDataResult {
  range: CostRange;
  setRange: (r: CostRange) => void;
  providerId: string;
  setProviderId: (v: string) => void;
  modelId: string;
  setModelId: (v: string) => void;
  window: CostWindow;
  events: Async<CostEventsResult>;
  metrics: Async<ReconciliationMetrics>;
  catalog: Async<CatalogResponse>;
  refresh: () => void;
}

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function useCostData(): UseCostDataResult {
  const env = useMemo(() => getEnvironment(), []);
  const [range, setRange] = useState<CostRange>("7d");
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [tick, setTick] = useState(0);

  const [win, setWin] = useState<CostWindow>(() => {
    const until = new Date();
    const since = new Date(until.getTime() - RANGE_MS["7d"]);
    return { since: since.toISOString(), until: until.toISOString(), label: RANGE_LABEL["7d"] };
  });
  const [events, setEvents] = useState<Async<CostEventsResult>>({ status: "loading" });
  const [metrics, setMetrics] = useState<Async<ReconciliationMetrics>>({ status: "loading" });
  const [catalog, setCatalog] = useState<Async<CatalogResponse>>({ status: "loading" });
  const reqId = useRef(0);

  useEffect(() => {
    const ctrl = new AbortController();
    const { signal } = ctrl;
    const id = ++reqId.current;

    const until = new Date();
    const since = new Date(until.getTime() - RANGE_MS[range]);
    const window: CostWindow = {
      since: since.toISOString(),
      until: until.toISOString(),
      label: RANGE_LABEL[range],
    };
    setWin(window);
    setEvents({ status: "loading" });

    (async () => {
      try {
        const all: TelemetryEvent[] = [];
        let cursor: string | undefined;
        let pages = 0;
        let truncated = false;
        do {
          const res = await listTelemetryEvents({
            since: window.since,
            until: window.until,
            limit: PAGE_SIZE,
            ...(cursor ? { cursor } : {}),
            ...(providerId ? { providerId } : {}),
            ...(modelId ? { modelId } : {}),
            ...(env.apiKey ? { apiKey: env.apiKey } : {}),
            signal,
          });
          all.push(...res.events);
          cursor = res.nextCursor ?? undefined;
          pages += 1;
          if (cursor && pages >= MAX_PAGES) {
            truncated = true;
            break;
          }
        } while (cursor);
        if (id === reqId.current) setEvents({ status: "ready", data: { events: all, truncated } });
      } catch (err) {
        if (signal.aborted || id !== reqId.current) return;
        setEvents({ status: "error", message: errMessage(err, "Telemetry unavailable") });
      }
    })();

    setMetrics({ status: "loading" });
    getReconciliationMetrics(signal)
      .then((data) => {
        if (id === reqId.current) setMetrics({ status: "ready", data });
      })
      .catch((err) => {
        if (!signal.aborted && id === reqId.current)
          setMetrics({ status: "error", message: errMessage(err, "Metrics unavailable") });
      });

    setCatalog({ status: "loading" });
    getCatalog({ ...(env.apiKey ? { apiKey: env.apiKey } : {}), signal })
      .then((data) => {
        if (id === reqId.current) setCatalog({ status: "ready", data });
      })
      .catch((err) => {
        if (!signal.aborted && id === reqId.current)
          setCatalog({ status: "error", message: errMessage(err, "Catalog unavailable") });
      });

    return () => ctrl.abort();
  }, [env, range, providerId, modelId, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return {
    range,
    setRange,
    providerId,
    setProviderId,
    modelId,
    setModelId,
    window: win,
    events,
    metrics,
    catalog,
    refresh,
  };
}
