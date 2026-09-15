"use client";
import { RefreshCw } from "lucide-react";
import styles from "./RoutingExplorer.module.css";

export type DecisionFilter = "" | "autopilot" | "operator_rule" | "client_override";
export type StatusFilter = "" | "success" | "failed";
export type TimeRange = "" | "1h" | "24h" | "7d";

export function RoutingExplorerFilters({
  search,
  onSearch,
  clientId,
  clients,
  onClient,
  modelId,
  models,
  onModel,
  decision,
  onDecision,
  statusFilter,
  onStatus,
  timeRange,
  onTimeRange,
  onRefresh,
  loading,
}: {
  search: string;
  onSearch: (v: string) => void;
  clientId: string;
  clients: string[];
  onClient: (v: string) => void;
  modelId: string;
  models: string[];
  onModel: (v: string) => void;
  decision: DecisionFilter;
  onDecision: (v: DecisionFilter) => void;
  statusFilter: StatusFilter;
  onStatus: (v: StatusFilter) => void;
  timeRange: TimeRange;
  onTimeRange: (v: TimeRange) => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  return (
    <div className={styles.filters} role="search">
      <input
        className={styles.search}
        type="text"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search request id, model or client…"
        aria-label="Search requests"
      />

      <select
        className={styles.select}
        value={clientId}
        onChange={(e) => onClient(e.target.value)}
        aria-label="Filter by client"
      >
        <option value="">All clients</option>
        {clients.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select
        className={styles.select}
        value={modelId}
        onChange={(e) => onModel(e.target.value)}
        aria-label="Filter by model"
      >
        <option value="">All models</option>
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      <select
        className={styles.select}
        value={decision}
        onChange={(e) => onDecision(e.target.value as DecisionFilter)}
        aria-label="Filter by decision source"
      >
        <option value="">All decisions</option>
        <option value="autopilot">Autopilot</option>
        <option value="operator_rule">Operator rule</option>
        <option value="client_override">Client override</option>
      </select>

      <select
        className={styles.select}
        value={statusFilter}
        onChange={(e) => onStatus(e.target.value as StatusFilter)}
        aria-label="Filter by status"
      >
        <option value="">All statuses</option>
        <option value="success">Success</option>
        <option value="failed">Failed</option>
      </select>

      <select
        className={styles.select}
        value={timeRange}
        onChange={(e) => onTimeRange(e.target.value as TimeRange)}
        aria-label="Filter by time range"
      >
        <option value="">All time</option>
        <option value="1h">Last 1h</option>
        <option value="24h">Last 24h</option>
        <option value="7d">Last 7d</option>
      </select>

      <button type="button" className={styles.btn} onClick={onRefresh} disabled={loading} aria-label="Refresh">
        <RefreshCw size={13} aria-hidden className={loading ? styles.spinning : undefined} />
        Refresh
      </button>
    </div>
  );
}
