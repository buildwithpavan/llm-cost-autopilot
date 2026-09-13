import type { TelemetryEvent, CandidateScore } from "../../types/index.js";

/**
 * Model Comparison radar: 5-axis polygon chart comparing up to 3 candidates
 * from the current TelemetryEvent's routingRationale.candidateRanking.
 *
 * Axes (in order, starting at the top and going clockwise):
 *   Cost · Latency · Quality · Reliability · Capability
 *
 * Each candidate value is `scoreBreakdown.<factor>Score` (already 0..1 from
 * the backend). Excluded candidates are drawn with dashed outlines.
 */

const AXES: Array<{ key: keyof CandidateScore["scoreBreakdown"] | string; label: string }> = [
  { key: "costScore", label: "Cost" },
  { key: "latencyScore", label: "Latency" },
  { key: "qualityScore", label: "Quality" },
  { key: "reliabilityScore", label: "Reliability" },
  { key: "capabilityScore", label: "Capability" },
];

const V = { w: 296, h: 220, cx: 148, cy: 110, r: 76 };

function pointOnAxis(idx: number, value: number): [number, number] {
  const angle = -Math.PI / 2 + (2 * Math.PI * idx) / AXES.length;
  const rr = V.r * Math.max(0, Math.min(1, value));
  return [V.cx + rr * Math.cos(angle), V.cy + rr * Math.sin(angle)];
}

function labelOnAxis(idx: number): [number, number] {
  const angle = -Math.PI / 2 + (2 * Math.PI * idx) / AXES.length;
  const rr = V.r + 20;
  return [V.cx + rr * Math.cos(angle), V.cy + rr * Math.sin(angle)];
}

export function ModelComparisonRadar({ event }: { event: TelemetryEvent }) {
  const ranking = event.routingRationale.candidateRanking;
  const included = ranking.filter((c) => c.included);
  const excluded = ranking.filter((c) => !c.included);
  const rankedIncluded = [...included].sort(
    (a, b) => (b.scoreBreakdown["total"] ?? 0) - (a.scoreBreakdown["total"] ?? 0),
  );

  const winner =
    rankedIncluded.find(
      (c) =>
        c.providerId === event.effectiveProviderId &&
        c.modelId === event.effectiveModelId,
    ) ?? rankedIncluded[0];
  const runnerUp = rankedIncluded.find((c) => c !== winner) ?? null;
  const excludedOne = excluded[0] ?? null;

  return (
    <section
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--r-card)",
        padding: "14px 16px",
        minHeight: 280,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
      aria-label="Model comparison"
    >
      <h4 style={{ margin: 0, fontSize: 11, color: "var(--text-primary)", fontWeight: 400 }}>
        Model Comparison
      </h4>
      <div
        style={{
          fontSize: 8,
          color: "var(--text-secondary)",
          display: "flex",
          gap: 14,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <LegendItem color="var(--accent-primary)" label="Selected" />
        {runnerUp ? (
          <LegendItem color="var(--text-secondary)" label={runnerUp.providerId} />
        ) : null}
        {excludedOne ? (
          <LegendItem color="var(--error)" label={`${excludedOne.providerId} (excluded)`} />
        ) : null}
      </div>

      <svg
        role="img"
        aria-label="Model comparison radar"
        viewBox={`0 0 ${V.w} ${V.h}`}
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        <Grid />
        {excludedOne ? (
          <RadarPath
            candidate={excludedOne}
            color="var(--error)"
            fillOpacity={0.05}
            dashed
          />
        ) : null}
        {runnerUp ? (
          <RadarPath
            candidate={runnerUp}
            color="var(--text-secondary)"
            fillOpacity={0.06}
          />
        ) : null}
        {winner ? (
          <RadarPath
            candidate={winner}
            color="var(--accent-primary)"
            fillOpacity={0.22}
          />
        ) : null}

        {AXES.map((a, i) => {
          const [tx, ty] = labelOnAxis(i);
          const key =
            a.key === "costScore"
              ? "cost"
              : a.key === "latencyScore"
                ? "latency"
                : a.key === "qualityScore"
                  ? "quality"
                  : a.key === "reliabilityScore"
                    ? "reliability"
                    : "capability";
          const winnerVal = winner ? (winner.scoreBreakdown[a.key as string] as number ?? 0) : 0;
          return (
            <g key={key} transform={`translate(${tx}, ${ty})`}>
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={8}
                fill="var(--text-secondary)"
                fontFamily="var(--font-sans)"
              >
                <tspan x={0} dy={-4}>{a.label}</tspan>
                <tspan x={0} dy={12} fontFamily="var(--font-mono)">
                  ({winnerVal.toFixed(3)})
                </tspan>
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span
        aria-hidden
        style={{ width: 6, height: 6, borderRadius: "50%", background: color }}
      />
      {label}
    </span>
  );
}

function Grid() {
  const rings = [0.25, 0.5, 0.75, 1];
  return (
    <g>
      {rings.map((r) => {
        const pts = AXES.map((_, i) => pointOnAxis(i, r)).map(([x, y]) => `${x},${y}`).join(" ");
        return (
          <polygon
            key={r}
            points={pts}
            fill="none"
            stroke="var(--border-default)"
            strokeWidth={0.5}
            opacity={0.7}
          />
        );
      })}
      {AXES.map((_, i) => {
        const [x, y] = pointOnAxis(i, 1);
        return (
          <line
            key={i}
            x1={V.cx}
            y1={V.cy}
            x2={x}
            y2={y}
            stroke="var(--border-default)"
            strokeWidth={0.5}
            opacity={0.6}
          />
        );
      })}
    </g>
  );
}

function RadarPath({
  candidate,
  color,
  fillOpacity,
  dashed,
}: {
  candidate: CandidateScore;
  color: string;
  fillOpacity: number;
  dashed?: boolean;
}) {
  const pts = AXES.map((a, i) => {
    const v = (candidate.scoreBreakdown[a.key as string] as number) ?? 0;
    return pointOnAxis(i, v);
  });
  const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x},${y}`).join(" ") + " Z";
  return (
    <path
      d={d}
      fill={color}
      fillOpacity={fillOpacity}
      stroke={color}
      strokeWidth={1.2}
      strokeDasharray={dashed ? "3 3" : undefined}
    />
  );
}
