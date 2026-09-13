const STAGES = [
  { num: "01", label: "Request", sub: "Incoming request" },
  { num: "02", label: "Governance", sub: "Apply rules" },
  { num: "03", label: "Evaluate", sub: "Score candidates" },
  { num: "04", label: "Decide", sub: "Select best" },
  { num: "05", label: "Execute", sub: "Run request" },
  { num: "06", label: "Result", sub: "Return response" },
] as const;

export function StageStrip() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(6, 1fr)",
        columnGap: 10,
        padding: "8px 14px 0",
      }}
    >
      {STAGES.map((s) => (
        <div key={s.num} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 600,
              color: "var(--accent-cyan)",
              letterSpacing: 0.08,
            }}
          >
            {s.num}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-primary)" }}>{s.label}</span>
          <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>{s.sub}</span>
        </div>
      ))}
    </div>
  );
}
