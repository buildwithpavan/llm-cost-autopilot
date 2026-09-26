"use client";
import { useEffect, useMemo, useState } from "react";

import type { TelemetryEvent } from "../../types/index.js";
import { getHealth, type HealthResponse } from "../../lib/api/health.js";
import { listTelemetryEvents } from "../../lib/api/telemetry.js";
import { getCatalog, type CatalogResponse } from "../../lib/api/catalog.js";
import { getReconciliationMetrics, type ReconciliationMetrics } from "../../lib/api/metrics.js";
import { getEnvironment } from "../../lib/env.js";
import { buildOverviewSections, type Async, type OverviewSections } from "./overview-model.js";

const LATEST_LIMIT = 12;

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export interface OverviewData {
  sections: OverviewSections;
  health: Async<HealthResponse>;
}

/** Fetches the four Overview sources independently so one failure never blanks the page. */
export function useOverviewData(): OverviewData {
  const env = useMemo(() => getEnvironment(), []);
  const [health, setHealth] = useState<Async<HealthResponse>>({ status: "loading" });
  const [events, setEvents] = useState<Async<readonly TelemetryEvent[]>>({ status: "loading" });
  const [catalog, setCatalog] = useState<Async<CatalogResponse>>({ status: "loading" });
  const [metrics, setMetrics] = useState<Async<ReconciliationMetrics>>({ status: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    const { signal } = ctrl;

    getHealth(signal)
      .then((data) => setHealth({ status: "ready", data }))
      .catch((err) => {
        if (!signal.aborted) setHealth({ status: "error", message: errMessage(err, "Health unavailable") });
      });

    listTelemetryEvents({ limit: LATEST_LIMIT, ...(env.apiKey ? { apiKey: env.apiKey } : {}), signal })
      .then((res) => setEvents({ status: "ready", data: res.events }))
      .catch((err) => {
        if (!signal.aborted) setEvents({ status: "error", message: errMessage(err, "Telemetry unavailable") });
      });

    getCatalog({ ...(env.apiKey ? { apiKey: env.apiKey } : {}), signal })
      .then((data) => setCatalog({ status: "ready", data }))
      .catch((err) => {
        if (!signal.aborted) setCatalog({ status: "error", message: errMessage(err, "Catalog unavailable") });
      });

    getReconciliationMetrics(signal)
      .then((data) => setMetrics({ status: "ready", data }))
      .catch((err) => {
        if (!signal.aborted) setMetrics({ status: "error", message: errMessage(err, "Metrics unavailable") });
      });

    return () => ctrl.abort();
  }, [env]);

  const sections = useMemo(
    () => buildOverviewSections({ health, events, catalog, metrics }),
    [health, events, catalog, metrics],
  );
  return { sections, health };
}
