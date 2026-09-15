"use client";
import type { TelemetryEvent } from "../../types/index.js";
import { formatUsd, formatMs, abbreviateId, formatClockTime, formatRelativeTime } from "../../lib/format.js";
import {
  decisionSourceMeta,
  statusMeta,
  reconciliationState,
  reconciliationMeta,
} from "./event-presenters.js";
import { AlertTriangle, ChevronRight, Inbox } from "lucide-react";
import styles from "./RoutingExplorer.module.css";

const COLUMNS = [
  "Time",
  "Request",
  "Client",
  "Model",
  "Decision",
  "Attempts",
  "Latency",
  "Est. Cost",
  "Reconciliation",
  "Status",
  "",
] as const;

export function RoutingExplorerTable({
  events,
  status,
  error,
  onSelect,
  onRetry,
  hasActiveFilters,
}: {
  events: TelemetryEvent[];
  status: "loading" | "ready" | "error";
  error: string | null;
  onSelect: (eventId: string) => void;
  onRetry: () => void;
  hasActiveFilters: boolean;
}) {
  if (status === "error") {
    return (
      <div className={styles.tableWrap}>
        <div className={styles.state} role="alert">
          <AlertTriangle size={24} className={styles.stateIcon} aria-hidden />
          <div className={styles.stateTitle}>Couldn’t load routing events</div>
          <div className={styles.stateBody}>{error ?? "The telemetry API request failed."}</div>
          <button type="button" className={styles.btn} onClick={onRetry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (status === "ready" && events.length === 0) {
    return (
      <div className={styles.tableWrap}>
        <div className={styles.state}>
          <Inbox size={24} className={styles.stateIcon} aria-hidden />
          <div className={styles.stateTitle}>
            {hasActiveFilters ? "No requests match these filters" : "No routing events yet"}
          </div>
          <div className={styles.stateBody}>
            {hasActiveFilters
              ? "Try clearing a filter or widening the time range."
              : "Requests routed through the autopilot will appear here as they are recorded."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {COLUMNS.map((c, i) => (
              <th key={c || `col-${i}`} className={i >= 6 && i <= 7 ? styles.numeric : undefined}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {status === "loading"
            ? Array.from({ length: 8 }, (_, i) => <SkeletonRow key={i} />)
            : events.map((e) => <EventRow key={e.eventId} event={e} onSelect={onSelect} />)}
        </tbody>
      </table>
    </div>
  );
}

function EventRow({ event, onSelect }: { event: TelemetryEvent; onSelect: (id: string) => void }) {
  const dec = decisionSourceMeta(event.decisionSource);
  const st = statusMeta(event);
  const rec = reconciliationMeta(reconciliationState(event));
  const attempts = event.attempts.length;
  const isFallback = attempts > 1;

  return (
    <tr
      className={styles.row}
      onClick={() => onSelect(event.eventId)}
      tabIndex={0}
      role="link"
      aria-label={`Open request ${event.eventId}`}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onSelect(event.eventId);
        }
      }}
    >
      <td>
        <span className={styles.timeCell}>
          <span className={styles.timeAbs}>{formatClockTime(event.receivedAt)}</span>
          <span className={styles.timeRel}>{formatRelativeTime(event.receivedAt)}</span>
        </span>
      </td>
      <td className={styles.mono} title={event.eventId}>
        {abbreviateId(event.eventId, 10)}
      </td>
      <td className={styles.mono}>{event.clientId}</td>
      <td>
        <span className={styles.model}>{event.effectiveModelId}</span>
      </td>
      <td>
        <span className={styles.badge} style={{ color: dec.color, background: dec.bg, border: `1px solid ${dec.border}` }}>
          {dec.label}
        </span>
        {event.shadowedSource ? <span className={styles.shadow}>shadowed</span> : null}
      </td>
      <td>
        <span className={`${styles.attempts} ${isFallback ? styles.attemptsFallback : ""}`.trim()}>
          {attempts}
        </span>
      </td>
      <td className={styles.numeric}>{formatMs(event.totalLatencyMs)}</td>
      <td className={styles.numeric}>{formatUsd(event.estimatedCostUsd)}</td>
      <td>
        <span className={styles.badge} style={{ color: rec.color, background: rec.bg, border: `1px solid ${rec.border}` }}>
          {rec.label}
        </span>
      </td>
      <td>
        <span className={styles.badge} style={{ color: st.color, background: st.bg, border: `1px solid ${st.border}` }}>
          {st.label}
        </span>
      </td>
      <td>
        <ChevronRight size={15} className={styles.chevron} aria-hidden />
      </td>
    </tr>
  );
}

function SkeletonRow() {
  const widths = ["70%", "80%", "60%", "85%", "60%", "40%", "50%", "60%", "55%", "50%", "20%"];
  return (
    <tr>
      {widths.map((w, i) => (
        <td key={i}>
          <div className={styles.skelBar} style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}
