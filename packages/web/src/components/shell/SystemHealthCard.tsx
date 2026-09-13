import { Dot } from "../primitives/Dot.js";

export function SystemHealthCard({
  healthy,
  version,
}: {
  healthy: boolean;
  version: string;
}) {
  return (
    <div
      style={{
        background: "#080e12",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--r-card)",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 10,
          fontWeight: 600,
          color: healthy ? "var(--success)" : "var(--warn)",
        }}
      >
        <Dot color={healthy ? "var(--success)" : "var(--warn)"} pulse={healthy} />
        {healthy ? "System Healthy" : "Degraded"}
      </div>
      <div style={{ fontSize: 9, color: "var(--text-secondary)" }}>
        {healthy ? "All services operational" : "One or more checks failed"}
      </div>
      <div
        style={{
          fontSize: 9,
          color: "var(--text-tertiary)",
          fontFamily: "var(--font-mono)",
          marginTop: 6,
        }}
      >
        {version}
      </div>
    </div>
  );
}
