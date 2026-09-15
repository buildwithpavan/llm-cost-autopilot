"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../components/shell/AppShell.js";
import { getEnvironment } from "../../lib/env.js";
import { useRoutingEvents, type ServerFilters } from "./useRoutingEvents.js";
import {
  RoutingExplorerFilters,
  type DecisionFilter,
  type StatusFilter,
  type TimeRange,
} from "./RoutingExplorerFilters.js";
import { RoutingExplorerTable } from "./RoutingExplorerTable.js";
import { distinctValues } from "./event-presenters.js";
import styles from "./RoutingExplorer.module.css";

const PAGE_SIZE = 50;

function sinceFromRange(range: TimeRange): string | undefined {
  if (!range) return undefined;
  const ms = range === "1h" ? 3_600_000 : range === "24h" ? 86_400_000 : 604_800_000;
  return new Date(Date.now() - ms).toISOString();
}

export function RoutingExplorerPage() {
  const env = useMemo(() => getEnvironment(), []);
  const router = useRouter();

  // Server-side filters (real API query params).
  const [clientId, setClientId] = useState("");
  const [modelId, setModelId] = useState("");
  const [timeRange, setTimeRange] = useState<TimeRange>("");
  // Local refinements over the loaded page.
  const [search, setSearch] = useState("");
  const [decision, setDecision] = useState<DecisionFilter>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");

  const filters: ServerFilters = useMemo(() => {
    const since = sinceFromRange(timeRange);
    return {
      ...(clientId ? { clientId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(since ? { since } : {}),
    };
  }, [clientId, modelId, timeRange]);

  const result = useRoutingEvents({
    filters,
    pageSize: PAGE_SIZE,
    ...(env.apiKey ? { apiKey: env.apiKey } : {}),
  });

  // Accumulate the client/model dropdown options so they persist as the loaded
  // page narrows under an active filter.
  const [knownClients, setKnownClients] = useState<string[]>([]);
  const [knownModels, setKnownModels] = useState<string[]>([]);
  useEffect(() => {
    if (result.events.length === 0) return;
    setKnownClients((prev) =>
      [...new Set([...prev, ...distinctValues(result.events, (e) => e.clientId)])].sort((a, b) => a.localeCompare(b)),
    );
    setKnownModels((prev) =>
      [...new Set([...prev, ...distinctValues(result.events, (e) => e.effectiveModelId)])].sort((a, b) =>
        a.localeCompare(b),
      ),
    );
  }, [result.events]);

  // Local filtering over the current page.
  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return result.events.filter((e) => {
      if (decision && e.decisionSource !== decision) return false;
      if (statusFilter === "success" && e.terminalErrorClass !== "none") return false;
      if (statusFilter === "failed" && e.terminalErrorClass === "none") return false;
      if (q) {
        const hit =
          e.eventId.toLowerCase().includes(q) ||
          e.effectiveModelId.toLowerCase().includes(q) ||
          e.clientId.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [result.events, search, decision, statusFilter]);

  const hasActiveFilters =
    Boolean(clientId || modelId || timeRange || search.trim() || decision || statusFilter);

  const connection = result.status === "loading" ? "connecting" : result.status === "error" ? "error" : "live";

  return (
    <AppShell
      connection={connection}
      envLabel={env.envLabel}
      healthy={result.status === "ready"}
      version={env.appVersion}
      activeKey="Traffic"
    >
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Routing Explorer</h1>
            <p className={styles.subtitle}>
              Browse and inspect LLM routing decisions across your traffic.
            </p>
          </div>
        </div>

        <RoutingExplorerFilters
          search={search}
          onSearch={setSearch}
          clientId={clientId}
          clients={knownClients}
          onClient={setClientId}
          modelId={modelId}
          models={knownModels}
          onModel={setModelId}
          decision={decision}
          onDecision={setDecision}
          statusFilter={statusFilter}
          onStatus={setStatusFilter}
          timeRange={timeRange}
          onTimeRange={setTimeRange}
          onRefresh={result.refresh}
          loading={result.status === "loading"}
        />

        <RoutingExplorerTable
          events={displayed}
          status={result.status}
          error={result.error}
          onSelect={(id) => router.push(`/traffic/${id}`)}
          onRetry={result.refresh}
          hasActiveFilters={hasActiveFilters}
        />

        <div className={styles.pagination}>
          <span className={styles.pageInfo}>
            {result.status === "ready"
              ? `Page ${result.pageIndex + 1} · ${displayed.length}${
                  displayed.length !== result.events.length ? ` of ${result.events.length}` : ""
                } request${result.events.length === 1 ? "" : "s"}`
              : "\u00a0"}
          </span>
          <div className={styles.pageBtns}>
            <button
              type="button"
              className={styles.btn}
              onClick={result.prev}
              disabled={!result.hasPrev || result.status === "loading"}
            >
              Previous
            </button>
            <button
              type="button"
              className={styles.btn}
              onClick={result.next}
              disabled={!result.hasNext || result.status === "loading"}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
