import {
  STAGE_COLORS as SHARED_STAGE_COLORS,
  segPath,
  fullSplinePath,
  segState,
  JourneySegment,
  JourneyParticle,
} from "../live-graph/journey-visuals.js";

/**
 * Decision Graph — request-journey visualisation.
 *
 * A single request particle travels a smooth spline through the real routing
 * lifecycle (Request → Governance → Evaluate → Model → Execute → Result),
 * dipping down into the selected model row and rejoining toward Execute.
 * Operator-rule journeys skip Evaluate; the branch to the model becomes the
 * dominant policy-pin route. Progress `t` is supplied by useRequestJourney,
 * which replays the already-known lifecycle at a perceptible cadence.
 *
 * Geometry (viewBox 820×340) is exported so HTML overlays align exactly.
 */

// Re-exported from the shared journey-visuals module so both views stay in sync.
export const STAGE_COLORS = SHARED_STAGE_COLORS;

export type Rect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

export const DECISION_VIEWBOX = { w: 1060, h: 520 };

// Every primary stage node shares ONE diameter — emphasis comes from glow /
// border / animation, never from a different circle size.
export const STAGE_NODE_R = 30;

const TOP_Y = 118;

// Two zones: a top Live-Request-Flow pipeline and a bottom Routing-Decision
// trace. Request Intent is vertically aligned under Client Input (same x).
// Model Execution sits just right of the candidate stack so the winner's
// return leg rises through open space; kept as tight as the labels allow.
export const NODES = {
  client: { x: 132, y: TOP_Y } as Point,
  router: { x: 400, y: TOP_Y } as Point,
  execution: { x: 764, y: TOP_Y } as Point,
  result: { x: 964, y: TOP_Y } as Point,
  intent: { x: 132, y: 384 } as Point,
};

// Request Intent has DISTINCT anchors, like any other stage: the Router path
// terminates at the ENTRY (top of the node); every candidate branch begins at
// the single EXIT (right of the node).
export const INTENT_ENTRY = { x: NODES.intent.x, y: NODES.intent.y - STAGE_NODE_R } as Point;
export const INTENT_EXIT = { x: NODES.intent.x + STAGE_NODE_R, y: NODES.intent.y } as Point;

// Back-compat alias for the single branch exit anchor.
export const BRANCH_ORIGIN = INTENT_EXIT;

// Back-compat aliases: all nodes are intentionally the same size now.
export const BADGE_R = STAGE_NODE_R;
export const HERO_R = STAGE_NODE_R;

// Candidate branch chips (bottom zone).
const CHIP_X = 420;
const CHIP_W = 280;
const CHIP_H = 64;
const CHIP_GAP = 30;

export type Chip = {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  left: Point;
  right: Point;
};

export function candidateChips(count: number): Chip[] {
  const n = Math.max(1, count);
  const total = n * CHIP_H + (n - 1) * CHIP_GAP;
  const startY = NODES.intent.y - total / 2;
  return Array.from({ length: n }, (_, i) => {
    const y = startY + i * (CHIP_H + CHIP_GAP);
    return {
      x: CHIP_X,
      y,
      w: CHIP_W,
      h: CHIP_H,
      cx: CHIP_X + CHIP_W / 2,
      cy: y + CHIP_H / 2,
      left: { x: CHIP_X, y: y + CHIP_H / 2 },
      right: { x: CHIP_X + CHIP_W, y: y + CHIP_H / 2 },
    };
  });
}

export function rectToStyle(r: Rect): React.CSSProperties {
  return {
    position: "absolute",
    left: `${(r.x / DECISION_VIEWBOX.w) * 100}%`,
    top: `${(r.y / DECISION_VIEWBOX.h) * 100}%`,
    width: `${(r.w / DECISION_VIEWBOX.w) * 100}%`,
    height: `${(r.h / DECISION_VIEWBOX.h) * 100}%`,
  };
}

export function badgeStyle(p: Point, r: number = BADGE_R): React.CSSProperties {
  const size = r * 2;
  return {
    position: "absolute",
    left: `${((p.x - r) / DECISION_VIEWBOX.w) * 100}%`,
    top: `${((p.y - r) / DECISION_VIEWBOX.h) * 100}%`,
    width: `${(size / DECISION_VIEWBOX.w) * 100}%`,
    height: `${(size / DECISION_VIEWBOX.h) * 100}%`,
  };
}

export function labelStyle(p: Point, width: number, yOffset: number): React.CSSProperties {
  return {
    position: "absolute",
    left: `${((p.x - width / 2) / DECISION_VIEWBOX.w) * 100}%`,
    top: `${((p.y + yOffset) / DECISION_VIEWBOX.h) * 100}%`,
    width: `${(width / DECISION_VIEWBOX.w) * 100}%`,
  };
}

export function DecisionGraphSvg({
  isOperatorRule,
  hasFallback,
  resultFailed,
  waypoints,
  colors,
  t,
  forkPoint,
  rejectedTargets,
  renderParticle = true,
}: {
  isOperatorRule: boolean;
  hasFallback: boolean;
  resultFailed: boolean;
  waypoints: Point[];
  colors: string[];
  t: number;
  forkPoint: Point;
  rejectedTargets: Point[];
  renderParticle?: boolean;
}) {
  return (
    <svg
      role="img"
      aria-label="Routing decision graph"
      viewBox={`0 0 ${DECISION_VIEWBOX.w} ${DECISION_VIEWBOX.h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
    >
      {/* Top pipeline continuity — faint direct router→execution (context) */}
      <path
        d={`M ${NODES.router.x + STAGE_NODE_R + 8},${NODES.router.y} C ${NODES.router.x + 150},${NODES.router.y} ${NODES.execution.x - 150},${NODES.execution.y} ${NODES.execution.x - STAGE_NODE_R - 8},${NODES.execution.y}`}
        fill="none"
        stroke="var(--border-default)"
        strokeWidth={1.4}
        strokeDasharray="2 6"
        strokeLinecap="round"
        opacity={0.35}
      />

      {/* Rejected branches — static, dim, dashed (the alternatives considered) */}
      {rejectedTargets.map((to, i) => (
        <FanEdge key={i} from={forkPoint} to={to} />
      ))}

      {/* Faint always-on journey track — keeps the full map (incl. the quiet
          upcoming top-right) readable before the particle traverses it. */}
      <path
        d={fullSplinePath(waypoints)}
        fill="none"
        stroke="var(--border-default)"
        strokeWidth={10}
        strokeLinecap="round"
        opacity={0.2}
      />

      {/* Winning journey path — one smooth segment per lifecycle step */}
      {waypoints.slice(0, -1).map((_, i) => (
        <JourneySegment key={i} d={segPath(waypoints, i)} color={colors[i + 1]!} state={segState(i, t)} />
      ))}

      {/* Particle is normally drawn on the foreground overlay so it stays visible
          over the winner card; kept here only when no overlay is used. */}
      {renderParticle ? <JourneyParticle waypoints={waypoints} colors={colors} t={t} /> : null}
      {resultFailed || hasFallback || isOperatorRule ? null : null}
    </svg>
  );
}

/**
 * Foreground particle layer — a transparent SVG rendered ABOVE the candidate
 * cards so the single request particle is never hidden behind the winner card
 * while it traverses center-left → center-right.
 */
export function ParticleOverlay({
  waypoints,
  colors,
  t,
}: {
  waypoints: Point[];
  colors: string[];
  t: number;
}) {
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${DECISION_VIEWBOX.w} ${DECISION_VIEWBOX.h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      <JourneyParticle waypoints={waypoints} colors={colors} t={t} />
    </svg>
  );
}


function FanEdge({ from, to }: { from: Point; to: Point }) {
  const dx = Math.max(30, (to.x - from.x) * 0.55);
  const d = `M ${from.x},${from.y} C ${from.x + dx},${from.y} ${to.x - dx},${to.y} ${to.x},${to.y}`;
  return (
    <>
      <path d={d} fill="none" stroke="var(--bg-canvas)" strokeWidth={3.2} strokeLinecap="round" opacity={0.9} />
      <path
        d={d}
        fill="none"
        stroke="var(--text-tertiary)"
        strokeWidth={1.6}
        strokeDasharray="5 5"
        strokeLinecap="round"
        opacity={0.7}
      />
    </>
  );
}

