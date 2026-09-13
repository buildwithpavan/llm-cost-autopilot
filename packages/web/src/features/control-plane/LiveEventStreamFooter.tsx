import type { TelemetryEvent } from "../../types/index.js";
import type { StreamConnectionState } from "../../lib/sse/connect-stream.js";
import { Dot } from "../../components/primitives/Dot.js";
import { abbreviateId } from "../../lib/format.js";
import styles from "./LiveEventStreamFooter.module.css";

const STATUS: Record<StreamConnectionState, { label: string; color: string; pulse: boolean }> = {
  idle: { label: "Awaiting stream…", color: "var(--text-tertiary)", pulse: false },
  connecting: { label: "Connecting…", color: "var(--warn)", pulse: true },
  live: { label: "Streaming events…", color: "var(--success)", pulse: true },
  reconnecting: { label: "Reconnecting…", color: "var(--warn)", pulse: true },
  disconnected: { label: "Disconnected", color: "var(--text-tertiary)", pulse: false },
  error: { label: "Stream error — retrying", color: "var(--error)", pulse: true },
};

export function LiveEventStreamFooter({
  latest,
  connection,
}: {
  latest: TelemetryEvent | null;
  connection: StreamConnectionState;
}) {
  const status = STATUS[connection];
  const line = latest
    ? `${latest.receivedAt}   [REQUEST]   req_${abbreviateId(latest.eventId, 8)}   ${latest.clientId}   inputTokens=${latest.aggregatedInputTokens}`
    : "—";

  return (
    <section className={styles.card} aria-label="Live event stream">
      <div className={styles.head}>
        <span className={styles.title}>Live Event Stream</span>
        <Dot color={status.color} pulse={status.pulse} />
        <span className={styles.status}>{status.label}</span>
      </div>
      <div className={styles.line}>{line}</div>
    </section>
  );
}
