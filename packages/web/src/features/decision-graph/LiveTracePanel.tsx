"use client";
import { useState } from "react";
import type { TraceEvent } from "./decision-graph.types.js";
import type { StreamConnectionState } from "../../lib/sse/connect-stream.js";
import { abbreviateId } from "../../lib/format.js";
import { Toggle } from "../../components/primitives/Toggle.js";
import styles from "./LiveTracePanel.module.css";

const STATUS: Record<StreamConnectionState, string> = {
  idle: "Awaiting stream…",
  connecting: "Connecting to telemetry stream…",
  live: "Streaming in real time…",
  reconnecting: "Reconnecting…",
  disconnected: "Stream disconnected",
  error: "Stream error — retrying",
};

export function LiveTracePanel({
  eventId,
  timeline,
  connection,
}: {
  eventId: string;
  timeline: TraceEvent[];
  connection: StreamConnectionState;
}) {
  const [autoScroll, setAutoScroll] = useState(true);

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>
          Live Trace: <span className={styles.mono}>req_{abbreviateId(eventId, 8)}</span>
        </h3>
        <div className={styles.status}>{STATUS[connection]}</div>
        <div className={styles.auto}>
          <span>Auto-scroll</span>
          <Toggle
            on={autoScroll}
            onChange={setAutoScroll}
            ariaLabel="Toggle auto-scroll"
            offColor="var(--bg-track)"
          />
        </div>
      </div>

      <ol className={styles.rows}>
        {timeline.map((t, i) => (
          <li key={`${t.stage}-${i}`} className={styles.row}>
            <span
              className={styles.dot}
              style={{
                background:
                  t.state === "completed"
                    ? "var(--success)"
                    : t.state === "failed"
                      ? "var(--error)"
                      : "var(--accent-cyan)",
                boxShadow:
                  i === timeline.length - 1 ? "0 0 0 3px rgba(38,214,138,0.18)" : undefined,
              }}
              aria-hidden
            />
            <span className={styles.time}>{`${t.offsetMs} ms`}</span>
            <span
              className={styles.title2}
              style={{ color: t.stage === "result" ? "var(--success)" : "var(--text-primary)" }}
            >
              {t.title}
            </span>
            <span className={styles.detail}>{t.detail}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
