/**
 * Shared request-journey visual primitives.
 *
 * Decision Graph and Control Plane are two projections of the SAME routing
 * lifecycle, so they share the stage palette, the spline maths, the segment
 * state model, and the single-particle rendering. Keeping these here prevents
 * the two views from drifting apart.
 */

export type Point = { x: number; y: number };

// Deliberately high-contrast neon palette on the dark canvas. Each stage must be
// unmistakably different from its neighbours.
export const STAGE_COLORS = {
  request: "#38bdf8", // sky blue
  governance: "#2dd4bf", // teal / turquoise
  evaluate: "#c084fc", // bright violet
  model: "#fbbf24", // bright gold (selected model)
  execute: "#6366f1", // indigo (clearly distinct from the violet Evaluate)
  resultOk: "#34d399", // emerald
  resultFail: "#fb7185", // rose
  fallback: "#fb923c", // orange (fallback path only)
};

const DIM = "var(--border-default)";

/** One smooth Catmull-Rom segment (as a cubic bezier) between waypoint i and i+1. */
export function splineSeg(w: Point[], i: number) {
  const p0 = w[i - 1] ?? w[i]!;
  const p1 = w[i]!;
  const p2 = w[i + 1]!;
  const p3 = w[i + 2] ?? w[i + 1]!;
  const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
  const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
  return { p1, c1, c2, p2 };
}

export function cubicAt(s: ReturnType<typeof splineSeg>, u: number): Point {
  const m = 1 - u;
  return {
    x: m * m * m * s.p1.x + 3 * m * m * u * s.c1.x + 3 * m * u * u * s.c2.x + u * u * u * s.p2.x,
    y: m * m * m * s.p1.y + 3 * m * m * u * s.c1.y + 3 * m * u * u * s.c2.y + u * u * u * s.p2.y,
  };
}

/** Position of the request particle at journey progress `t` along the spline. */
export function pointAt(w: Point[], t: number): Point {
  if (w.length < 2) return w[0] ?? { x: 0, y: 0 };
  const maxSeg = w.length - 2;
  const seg = Math.max(0, Math.min(maxSeg, Math.floor(t)));
  const u = Math.max(0, Math.min(1, t - seg));
  return cubicAt(splineSeg(w, seg), u);
}

/** SVG path "d" for a single spline segment i. */
export function segPath(w: Point[], i: number): string {
  const s = splineSeg(w, i);
  return `M ${s.p1.x},${s.p1.y} C ${s.c1.x},${s.c1.y} ${s.c2.x},${s.c2.y} ${s.p2.x},${s.p2.y}`;
}

/** Full spline path across all waypoints (used for the faint static rail). */
export function fullSplinePath(w: Point[]): string {
  let d = "";
  for (let i = 0; i < w.length - 1; i++) {
    const s = splineSeg(w, i);
    d += i === 0 ? `M ${s.p1.x},${s.p1.y} ` : "";
    d += `C ${s.c1.x},${s.c1.y} ${s.c2.x},${s.c2.y} ${s.p2.x},${s.p2.y} `;
  }
  return d.trim();
}

export function segState(i: number, t: number): "completed" | "active" | "upcoming" {
  if (t >= i + 1) return "completed";
  if (t > i) return "active";
  return "upcoming";
}

/** A single journey connector, coloured by whether it is done / active / ahead. */
export function JourneySegment({
  d,
  color,
  state,
}: {
  d: string;
  color: string;
  state: "completed" | "active" | "upcoming";
}) {
  if (state === "upcoming") {
    return (
      <path
        d={d}
        fill="none"
        stroke={DIM}
        strokeWidth={1.6}
        strokeDasharray="2 6"
        strokeLinecap="round"
        opacity={0.5}
      />
    );
  }
  if (state === "completed") {
    return (
      <path d={d} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" opacity={0.55} />
    );
  }
  // active — bright flowing dash + glow
  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={3.2}
      strokeLinecap="round"
      className="lca-flow-edge"
      style={{ color, filter: `drop-shadow(0 0 5px ${color})` }}
      strokeDasharray="8 5"
    />
  );
}

/**
 * The one and only request particle: a comet with a stage-coloured glow, a white
 * core, and a short fading trail evaluated on the same spline. Hidden once the
 * journey has arrived at the terminal (t ≈ segments).
 */
export function JourneyParticle({
  waypoints,
  colors,
  t,
}: {
  waypoints: Point[];
  colors: string[];
  t: number;
}) {
  const segments = waypoints.length - 1;
  if (t >= segments - 0.001) return null;
  const pos = pointAt(waypoints, t);
  const color = colors[Math.max(1, Math.min(colors.length - 1, Math.ceil(t)))]!;
  const trail = Array.from({ length: 6 }, (_, k) => {
    const tt = t - (k + 1) * 0.05;
    if (tt <= 0) return null;
    return { p: pointAt(waypoints, tt), k };
  }).filter((x): x is { p: Point; k: number } => x !== null);

  return (
    <g>
      {trail.map(({ p, k }) => (
        <circle key={k} cx={p.x} cy={p.y} r={3.6 * (1 - k / 7)} fill={color} opacity={0.3 * (1 - k / 7)} />
      ))}
      <circle cx={pos.x} cy={pos.y} r={15} fill={color} opacity={0.16} />
      <circle cx={pos.x} cy={pos.y} r={8.5} fill={color} opacity={0.4} />
      <circle cx={pos.x} cy={pos.y} r={5.6} fill="none" stroke={color} strokeWidth={1.6} opacity={0.95} />
      <circle cx={pos.x} cy={pos.y} r={3.6} fill="#ffffff" style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
    </g>
  );
}
