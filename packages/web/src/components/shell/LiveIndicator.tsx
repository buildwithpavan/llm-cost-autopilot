import { Dot } from "../primitives/Dot.js";
import type { StreamConnectionState } from "../../lib/sse/connect-stream.js";

const LABEL: Record<StreamConnectionState, string> = {
  idle: "Idle",
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  disconnected: "Offline",
  error: "Error",
};

const COLOR: Record<StreamConnectionState, string> = {
  idle: "var(--text-tertiary)",
  connecting: "var(--warn)",
  live: "var(--success)",
  reconnecting: "var(--warn)",
  disconnected: "var(--text-tertiary)",
  error: "var(--error)",
};

const BG: Record<StreamConnectionState, string> = {
  idle: "transparent",
  connecting: "rgba(245,171,71,0.08)",
  live: "var(--bg-live-pill)",
  reconnecting: "rgba(245,171,71,0.08)",
  disconnected: "transparent",
  error: "rgba(248,113,113,0.08)",
};

const BORDER: Record<StreamConnectionState, string> = {
  idle: "var(--border-default)",
  connecting: "var(--warn)",
  live: "var(--success)",
  reconnecting: "var(--warn)",
  disconnected: "var(--border-default)",
  error: "var(--error)",
};

export function LiveIndicator({ state }: { state: StreamConnectionState }) {
  return (
    <span
      role="status"
      aria-live="polite"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        height: 32,
        borderRadius: "var(--r-tab)",
        background: BG[state],
        border: `1px solid ${BORDER[state]}`,
        fontFamily: "var(--font-sans)",
        fontSize: 11,
        fontWeight: 600,
        color: "var(--text-primary)",
        lineHeight: 1,
        transition: "background var(--dur-2) var(--ease), border-color var(--dur-2) var(--ease)",
      }}
    >
      <Dot color={COLOR[state]} pulse={state === "live" || state === "reconnecting"} />
      {LABEL[state]}
    </span>
  );
}
