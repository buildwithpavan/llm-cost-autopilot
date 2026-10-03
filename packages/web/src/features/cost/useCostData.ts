"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TelemetryEvent } from "../../types/index.js";
import {
  getTelemetrySummary,
  listTelemetryEvents,
  getTelemetryTimeseries,
  getTelemetryAnomalies,
  type TelemetrySummaryResponse,
  type TimeseriesResponse,
  type AnomaliesResponse,
} from "../../lib/api/telemetry.js";
import { getCatalog, type CatalogResponse } from "../../lib/api/catalog.js";
import { getReconciliationMetrics, type ReconciliationMetrics } from "../../lib/api/metrics.js";
import { getBudgetStatus, getBudgetDecisions, type BudgetStatusResponse, type BudgetDecisionsResponse } from "../../lib/api/budgets.js";
import { getEnvironment } from "../../lib/env.js";
import type { Async } from "../overview/overview-model.js";
import { bucketForRange } from "./timeseries-model.js";

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

/** Recent-request rows the Cost Dashboard renders; the raw-event fetch is bounded to this. */
const RECENT_LIMIT = 15;

/** Recent budget decisions shown in the audit panel (activity view, not aggregation). */
const BUDGET_DECISIONS_LIMIT = 20;

export interface CostWindow {
  since: string;
  until: string;
  label: string;
}

export interface UseCostDataResult {
  range: CostRange;
  setRange: (r: CostRange) => void;
  providerId: string;
  setProviderId: (v: string) => void;
  modelId: string;
  setModelId: (v: string) => void;
  window: CostWindow;
  summary: Async<TelemetrySummaryResponse>;
  events: Async<TelemetryEvent[]>;
  metrics: Async<ReconciliationMetrics>;
  catalog: Async<CatalogResponse>;
  budgets: Async<BudgetStatusResponse>;
  budgetDecisions: Async<BudgetDecisionsResponse>;
  timeseries: Async<TimeseriesResponse>;
  anomalies: Async<AnomaliesResponse>;
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
  const [summary, setSummary] = useState<Async<TelemetrySummaryResponse>>({ status: "loading" });
  const [events, setEvents] = useState<Async<TelemetryEvent[]>>({ status: "loading" });
  const [metrics, setMetrics] = useState<Async<ReconciliationMetrics>>({ status: "loading" });
  const [catalog, setCatalog] = useState<Async<CatalogResponse>>({ status: "loading" });
  const [budgets, setBudgets] = useState<Async<BudgetStatusResponse>>({ status: "loading" });
  const [budgetDecisions, setBudgetDecisions] = useState<Async<BudgetDecisionsResponse>>({ status: "loading" });
  const reqId = useRef(0);
  const budgetReqId = useRef(0);
  const budgetDecReqId = useRef(0);
  const [timeseries, setTimeseries] = useState<Async<TimeseriesResponse>>({ status: "loading" });
  const seriesReqId = useRef(0);
  const [anomalies, setAnomalies] = useState<Async<AnomaliesResponse>>({ status: "loading" });
  const anomalyReqId = useRef(0);

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

    const keyOpt = env.apiKey ? { apiKey: env.apiKey } : {};

    // Aggregate totals + provider/model breakdowns (server-aggregated, unbounded window count).
    setSummary({ status: "loading" });
    getTelemetrySummary({
      since: window.since,
      until: window.until,
      ...(providerId ? { providerId } : {}),
      ...(modelId ? { modelId } : {}),
      ...keyOpt,
      signal,
    })
      .then((data) => {
        if (id === reqId.current) setSummary({ status: "ready", data });
      })
      .catch((err) => {
        if (!signal.aborted && id === reqId.current)
          setSummary({ status: "error", message: errMessage(err, "Summary unavailable") });
      });

    // Bounded raw-event fetch: only for RecentRequests + event-level reconciliation context.
    setEvents({ status: "loading" });
    listTelemetryEvents({
      since: window.since,
      until: window.until,
      limit: RECENT_LIMIT,
      ...(providerId ? { providerId } : {}),
      ...(modelId ? { modelId } : {}),
      ...keyOpt,
      signal,
    })
      .then((res) => {
        if (id === reqId.current) setEvents({ status: "ready", data: res.events });
      })
      .catch((err) => {
        if (!signal.aborted && id === reqId.current)
          setEvents({ status: "error", message: errMessage(err, "Telemetry unavailable") });
      });

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
    getCatalog({ ...keyOpt, signal })
      .then((data) => {
        if (id === reqId.current) setCatalog({ status: "ready", data });
      })
      .catch((err) => {
        if (!signal.aborted && id === reqId.current)
          setCatalog({ status: "error", message: errMessage(err, "Catalog unavailable") });
      });

    return () => ctrl.abort();
  }, [env, range, providerId, modelId, tick]);

  // Budget status is an independent operational concern: its window is
  // backend-defined (daily / rolling_30d), so it is NOT keyed on the selected
  // range or provider/model filters and never receives since/until.
  useEffect(() => {
    const ctrl = new AbortController();
    const { signal } = ctrl;
    const id = ++budgetReqId.current;
    setBudgets({ status: "loading" });
    getBudgetStatus({ ...(env.apiKey ? { apiKey: env.apiKey } : {}), signal })
      .then((data) => {
        if (id === budgetReqId.current) setBudgets({ status: "ready", data });
      })
      .catch((err) => {
        if (!signal.aborted && id === budgetReqId.current)
          setBudgets({ status: "error", message: errMessage(err, "Budgets unavailable") });
      });
    return () => ctrl.abort();
  }, [env, tick]);

  // Recent budget decisions (warned/blocked) audit feed. Uses the dashboard's
  // selected time window (range), but is NOT keyed on provider/model filters.
  useEffect(() => {
    const ctrl = new AbortController();
    const { signal } = ctrl;
    const id = ++budgetDecReqId.current;
    const until = new Date();
    const since = new Date(until.getTime() - RANGE_MS[range]);
    setBudgetDecisions({ status: "loading" });
    getBudgetDecisions({
      since: since.toISOString(),
      until: until.toISOString(),
      limit: BUDGET_DECISIONS_LIMIT,
      ...(env.apiKey ? { apiKey: env.apiKey } : {}),
      signal,
    })
      .then((data) => {
        if (id === budgetDecReqId.current) setBudgetDecisions({ status: "ready", data });
      })
      .catch((err) => {
        if (!signal.aborted && id === budgetDecReqId.current)
          setBudgetDecisions({ status: "error", message: errMessage(err, "Budget decisions unavailable") });
      });
    return () => ctrl.abort();
  }, [env, range, tick]);

  // Time-series trend for the "Cost & Usage Trend" panel. Independent source:
  // its own request id + state so it never blocks (and is never blocked by) the
  // summary/events/budget sources. Keyed on the selected range + provider/model
  // filters; bucket is derived deterministically from the range.
  useEffect(() => {
    const ctrl = new AbortController();
    const { signal } = ctrl;
    const id = ++seriesReqId.current;
    const until = new Date();
    const since = new Date(until.getTime() - RANGE_MS[range]);
    const bucket = bucketForRange(range);
    setTimeseries({ status: "loading" });
    getTelemetryTimeseries({
      since: since.toISOString(),
      until: until.toISOString(),
      bucket,
      ...(providerId ? { providerId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(env.apiKey ? { apiKey: env.apiKey } : {}),
      signal,
    })
      .then((data) => {
        if (id === seriesReqId.current) setTimeseries({ status: "ready", data });
      })
      .catch((err) => {
        if (!signal.aborted && id === seriesReqId.current)
          setTimeseries({ status: "error", message: errMessage(err, "Trend unavailable") });
      });
    return () => ctrl.abort();
  }, [env, range, providerId, modelId, tick]);

  // Cost anomalies for the "Cost Anomalies" panel. Independent source (own
  // request id + state + catch), keyed on the same range + provider/model
  // filters; bucket is derived deterministically from the range.
  useEffect(() => {
    const ctrl = new AbortController();
    const { signal } = ctrl;
    const id = ++anomalyReqId.current;
    const until = new Date();
    const since = new Date(until.getTime() - RANGE_MS[range]);
    const bucket = bucketForRange(range);
    setAnomalies({ status: "loading" });
    getTelemetryAnomalies({
      since: since.toISOString(),
      until: until.toISOString(),
      bucket,
      ...(providerId ? { providerId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(env.apiKey ? { apiKey: env.apiKey } : {}),
      signal,
    })
      .then((data) => {
        if (id === anomalyReqId.current) setAnomalies({ status: "ready", data });
      })
      .catch((err) => {
        if (!signal.aborted && id === anomalyReqId.current)
          setAnomalies({ status: "error", message: errMessage(err, "Anomalies unavailable") });
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
    summary,
    events,
    metrics,
    catalog,
    budgets,
    budgetDecisions,
    timeseries,
    anomalies,
    refresh,
  };
}
