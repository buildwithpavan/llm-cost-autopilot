import type { TelemetryEvent } from "../../types/index.js";
import type { CandidateView, TraceEvent } from "./decision-graph.types.js";
import type { EdgeStateMap, LiveGraphState } from "../live-graph/graph-reducer.js";
import type { StreamConnectionState } from "../../lib/sse/connect-stream.js";
import {
  DecisionGraphSvg,
  ParticleOverlay,
  NODES,
  INTENT_ENTRY,
  INTENT_EXIT,
  STAGE_COLORS,
  candidateChips,
  badgeStyle,
  labelStyle,
  rectToStyle,
  type Point,
} from "./DecisionGraphSvg.js";
import { LiveTracePanel } from "./LiveTracePanel.js";
import { DecisionDetailsOverlay } from "./DecisionDetailsOverlay.js";
import { CandidateRow } from "../control-plane/CandidatesMiniList.js";
import { useRequestJourney } from "../../hooks/useRequestJourney.js";
import { formatMs, abbreviateId } from "../../lib/format.js";
import {
  Terminal,
  ShieldCheck,
  Cpu,
  Layers,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import styles from "./DecisionGraphPanel.module.css";

export function DecisionGraphPanel({
  event,
  candidates,
  timeline,
  connection,
  graph,
}: {
  event: TelemetryEvent;
  candidates: CandidateView[];
  timeline: TraceEvent[];
  edges: EdgeStateMap;
  connection: StreamConnectionState;
  graph: LiveGraphState;
}) {
  const liveAttempts = graph.attempts.length > 0
    ? graph.attempts
    : event.attempts.map((a) => ({
        attemptIndex: a.attemptIndex,
        providerId: a.providerId,
        modelId: a.modelId,
        latencyMs: a.latencyMs,
        inputTokens: a.inputTokens,
        outputTokens: a.outputTokens,
        errorClass: a.errorClass,
        estimatedCostUsd: a.estimatedCostUsd,
        actualCostUsd: a.actualCostUsd,
        startedAt: a.startedAt,
        endedAt: a.endedAt,
        pricingTableVersionId: a.pricingTableVersionId,
      }));
  const hasFallback = graph.hasFallback || liveAttempts.length > 1;
  const inputTokens = liveAttempts[0]?.inputTokens ?? 0;
  const isOperatorRule =
    (graph.decisionSource ?? event.decisionSource) === "operator_rule";
  const shadowedOverride =
    (graph.shadowedSource ?? event.shadowedSource) === "client_override";
  const resultOk = event.terminalErrorClass === "none";
  const resultFailed = !resultOk;
  const resultStageColor = resultFailed ? STAGE_COLORS.resultFail : STAGE_COLORS.resultOk;

  // --- Unified request journey: Live Request Flow (top) + Routing Decision
  // Trace (bottom). ONE particle flows Client → Router → down to Request Intent
  // → the SELECTED candidate (top/middle/bottom) → up to Execution → Result.
  //
  // Candidates render in a stable model-name order so the winner is not pinned
  // to the top row — this makes the branch geometry (and the winner path) prove
  // it dynamically follows whichever candidate actually won. Real data unchanged.
  const orderedCandidates = [...candidates].sort((a, b) => a.modelId.localeCompare(b.modelId));
  const chips = candidateChips(orderedCandidates.length);
  const winnerIdx = Math.max(0, orderedCandidates.findIndex((c) => c.kind === "winner"));
  const winnerCand = orderedCandidates[winnerIdx] ?? orderedCandidates[0] ?? null;
  const winnerChip = chips[winnerIdx] ?? chips[0]!;
  // Winner enters at its CENTER-LEFT and the return leaves from its CENTER-RIGHT
  // (a real processing stage). The particle is drawn on a foreground overlay so
  // it stays visible while crossing the opaque winner card.
  const winnerPoint: Point = { x: winnerChip.x + 18, y: winnerChip.cy };
  const winnerExit: Point = { x: winnerChip.right.x + 18, y: winnerChip.cy };
  // Every candidate branch fans from the SINGLE exit anchor on the intent node.
  const forkPoint = INTENT_EXIT;
  const rejectedTargets = chips.filter((_, i) => i !== winnerIdx).map((c) => c.left);

  // Model that actually ran (last successful attempt) — distinct from the
  // router's original pick when a fallback occurred. Grounded in real attempts.
  const routerSelectedModelId = winnerCand?.modelId ?? null;
  const executedModelId =
    [...liveAttempts].reverse().find((a) => a.errorClass === "none")?.modelId ??
    liveAttempts[liveAttempts.length - 1]?.modelId ??
    routerSelectedModelId;
  const executedAfterFallback =
    hasFallback && executedModelId != null && executedModelId !== routerSelectedModelId;

  // Distinct ENTRY (top of intent, where Router arrives) and EXIT (right of
  // intent, where all branches begin) anchors — like every other stage.
  const modelToExecColor = hasFallback ? STAGE_COLORS.fallback : STAGE_COLORS.execute;
  const waypoints: Point[] = [
    NODES.client,
    NODES.router,
    INTENT_ENTRY,
    INTENT_EXIT,
    winnerPoint,
    winnerExit,
    NODES.execution,
    NODES.result,
  ];
  const colors = [
    STAGE_COLORS.request,
    STAGE_COLORS.governance,
    STAGE_COLORS.evaluate,
    STAGE_COLORS.evaluate,
    STAGE_COLORS.model,
    STAGE_COLORS.model,
    modelToExecColor,
    resultStageColor,
  ];

  const idxClient = 0;
  const idxRouter = 1;
  const idxExecution = 6;
  const idxResult = 7;

  const journeyT = useRequestJourney(event.eventId, waypoints.length - 1);

  const stageAt = (i: number) => {
    if (i < 0) return { active: false, done: false };
    return { active: Math.abs(journeyT - i) <= 0.5, done: journeyT > i + 0.5 };
  };
  const clientStage = stageAt(idxClient);
  const routerStage = stageAt(idxRouter);
  // Intent is active while the particle enters (idx 2) and exits (idx 3).
  const intentStage = { active: journeyT > 1.5 && journeyT < 3.5, done: journeyT >= 3.5 };
  const executionStage = stageAt(idxExecution);
  const resultStage = stageAt(idxResult);
  // Winner card stays lit while the particle enters (idx 4) and exits (idx 5).
  const modelActive = journeyT > 3.5 && journeyT < 5.5;

  return (
    <section className={styles.panel} aria-label="AI Routing Trace">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>AI Routing Trace (Live)</h2>
          <p className={styles.subtitle}>
            One request, end to end — how it routed, which models were considered, and why this one ran.
          </p>
        </div>
        <div className={styles.tabs} role="tablist" aria-label="View mode">
          <button className={`${styles.tab} ${styles.tabActive}`} role="tab" aria-selected="true">
            Live
          </button>
          <button className={styles.tab} role="tab" aria-selected="false">
            Trace
          </button>
          <button className={styles.tab} role="tab" aria-selected="false">
            Compare
          </button>
        </div>
      </header>

      <div className={styles.graphWrap}>
        <div className={styles.graphInner}>
          <DecisionGraphSvg
            isOperatorRule={isOperatorRule}
            hasFallback={hasFallback}
            resultFailed={resultFailed}
            waypoints={waypoints}
            colors={colors}
            t={journeyT}
            forkPoint={forkPoint}
            rejectedTargets={rejectedTargets}
            renderParticle={false}
          />

          {/* --- Zone labels ---------------------------------------------- */}
          <div className={styles.zoneLabel} style={labelStyle({ x: 226, y: 24 }, 400, 0)}>
            Live Request Flow
          </div>
          <div className={styles.zoneLabel} style={labelStyle({ x: 230, y: 246 }, 400, 0)}>
            Routing Decision Trace
          </div>

          {/* --- Top zone: Control-Plane pipeline -------------------------- */}
          <StageBadge
            centre={NODES.client}
            icon={<Terminal size={24} strokeWidth={2.4} color={STAGE_COLORS.request} aria-hidden />}
            tint={STAGE_COLORS.request}
            active={clientStage.active}
            complete={clientStage.done}
          />
          <StageLabel centre={NODES.client} step="01" title="CLIENT INPUT" />
          <div style={labelStyle(NODES.client, 140, 44)} className={styles.stageChip}>
            <div className={styles.stageChipMono}>{`${inputTokens.toLocaleString()} tokens`}</div>
            <div className={styles.stageChipMuted}>{event.clientId}</div>
          </div>

          <StageBadge
            centre={NODES.router}
            icon={
              <ShieldCheck
                size={28}
                strokeWidth={2.4}
                color={isOperatorRule ? STAGE_COLORS.fallback : STAGE_COLORS.governance}
                aria-hidden
              />
            }
            tint={isOperatorRule ? STAGE_COLORS.fallback : STAGE_COLORS.governance}
            active={routerStage.active}
            complete={routerStage.done}
            highlight={isOperatorRule}
          />
          <StageLabel
            centre={NODES.router}
            step="02"
            title={isOperatorRule ? "OPERATOR RULE" : "AUTOPILOT ROUTER"}
            {...(isOperatorRule ? { accent: STAGE_COLORS.fallback } : {})}
          />
          {/* Metadata shifted below-right: the Router→Intent path dips below-left. */}
          <div style={labelStyle({ x: NODES.router.x + 54, y: NODES.router.y }, 150, 44)} className={styles.stageChip}>
            <div className={styles.stageChipMuted}>
              {isOperatorRule && graph.matchedRuleId
                ? `rule ${abbreviateId(graph.matchedRuleId, 6)}`
                : shadowedOverride
                  ? "shadowed override"
                  : `deciding · ${formatMs(event.totalLatencyMs)}`}
            </div>
          </div>

          <StageBadge
            centre={NODES.execution}
            icon={<Layers size={26} strokeWidth={2.4} color={hasFallback ? STAGE_COLORS.fallback : STAGE_COLORS.execute} aria-hidden />}
            tint={hasFallback ? STAGE_COLORS.fallback : STAGE_COLORS.execute}
            active={executionStage.active}
            complete={executionStage.done}
          />
          <StageLabel centre={NODES.execution} step="03" title="MODEL EXECUTION" />
          {/* Metadata shifted below-right: the winner→Execution return dips below-left. */}
          <div style={labelStyle({ x: NODES.execution.x + 72, y: NODES.execution.y }, 140, 44)} className={styles.stageChip}>
            <div className={styles.stageChipMono} style={{ color: "var(--model-accent, var(--text-primary))" }}>
              {executedModelId ?? "—"}
            </div>
            {executedAfterFallback ? (
              <div className={`${styles.stageChipTag} ${styles.stageChipFallback}`}>after fallback</div>
            ) : null}
          </div>

          <StageBadge
            centre={NODES.result}
            icon={
              resultOk ? (
                <CheckCircle2 size={30} strokeWidth={2.5} color={STAGE_COLORS.resultOk} aria-hidden />
              ) : (
                <XCircle size={30} strokeWidth={2.5} color={STAGE_COLORS.resultFail} aria-hidden />
              )
            }
            tint={resultOk ? STAGE_COLORS.resultOk : STAGE_COLORS.resultFail}
            terminal
            active={resultStage.active && !resultFailed}
            complete={resultStage.active || resultStage.done}
            failed={resultFailed && (resultStage.active || resultStage.done)}
          />
          <StageLabel
            centre={NODES.result}
            step="04"
            title={resultOk ? "EVALUATION & RESULT" : "FAILED"}
            accent={resultOk ? STAGE_COLORS.resultOk : STAGE_COLORS.resultFail}
          />
          <div style={labelStyle(NODES.result, 136, 44)} className={styles.stageChip}>
            <div
              className={styles.stageChipTitle}
              style={{ color: resultOk ? "var(--success)" : "var(--error)" }}
            >
              {resultOk ? "Success" : event.terminalErrorClass}
            </div>
            <div className={styles.stageChipMono}>{formatMs(event.totalLatencyMs)}</div>
          </div>

          {/* --- Bottom zone: Decision Graph — Request Intent -------------- */}
          <StageBadge
            centre={NODES.intent}
            icon={<Cpu size={26} strokeWidth={2.5} color={STAGE_COLORS.evaluate} aria-hidden />}
            tint={STAGE_COLORS.evaluate}
            active={intentStage.active}
            complete={intentStage.done}
          />
          {/* Title sits BELOW the node — the Router→Intent path enters the top. */}
          <StageLabel centre={NODES.intent} step="" title="REQUEST INTENT" below />
          <div style={labelStyle(NODES.intent, 156, 62)} className={styles.stageChip}>
            <div className={styles.stageChipTitle}>
              {isOperatorRule ? "Policy pin" : "Autopilot routing"}
            </div>
            {isOperatorRule ? (
              <div className={`${styles.stageChipTag} ${styles.stageChipBypass}`}>evaluation bypassed</div>
            ) : (
              <div className={styles.stageChipMono}>{`req_${abbreviateId(event.eventId, 6)}`}</div>
            )}
          </div>

          {/* --- Candidate branch chips + rejection reasons --------------- */}
          {chips.map((chip, i) => {
            const c = orderedCandidates[i];
            if (!c || i === winnerIdx) return null;
            const failed = c.kind === "excluded";
            const reason =
              failed && c.exclusionReason ? c.exclusionReason : `score ${c.score.toFixed(3)}`;
            return (
              <div
                key={`reason:${c.providerId}:${c.modelId}`}
                className={styles.branchReason}
                style={labelStyle({ x: chip.cx, y: chip.y - 15 }, chip.w, 0)}
              >
                <span className={failed ? styles.reasonFail : styles.reasonMuted}>
                  {failed ? "FAIL" : "NOT SELECTED"}
                </span>
                <span className={styles.reasonText}>{reason}</span>
              </div>
            );
          })}
          {chips.map((chip, i) => {
            const c = orderedCandidates[i];
            if (!c) return null;
            return (
              <div key={`${c.providerId}:${c.modelId}`} className={styles.branchChip} style={rectToStyle(chip)}>
                <CandidateRow
                  candidate={c}
                  activeSelection={modelActive && i === winnerIdx}
                  showReason={false}
                />
              </div>
            );
          })}

          {/* Foreground particle — above the cards so it never hides behind the
              winner while crossing center-left → center-right. */}
          <ParticleOverlay waypoints={waypoints} colors={colors} t={journeyT} />
        </div>
      </div>

      {liveAttempts.length > 1 || hasFallback ? (
        <div className={styles.attempts} role="group" aria-label="Attempt chain">
          {liveAttempts.map((a, i) => {
            const ok = a.errorClass === "none";
            return (
              <div key={i} className={ok ? styles.attemptOk : styles.attemptFailed}>
                <span
                  className={styles.attemptDot}
                  style={{ background: ok ? "var(--success)" : "var(--error)" }}
                  aria-hidden
                />
                <span className={styles.attemptRank}>ATTEMPT {a.attemptIndex}</span>
                <span className={styles.attemptModel}>{a.modelId}</span>
                <span className={styles.attemptMeta}>
                  {ok ? `${a.latencyMs} ms` : a.errorClass}
                </span>
              </div>
            );
          })}
          {hasFallback ? (
            <div className={styles.fallbackChip}>
              <AlertTriangle size={12} color="var(--warn)" aria-hidden />
              <span>single automatic fallback per FR-033</span>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={styles.bottomRow}>
        <LiveTracePanel eventId={event.eventId} timeline={timeline} connection={connection} />
        <DecisionDetailsOverlay event={event} />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                             */
/* -------------------------------------------------------------------------- */

function StageBadge({
  centre,
  icon,
  tint,
  r,
  active = false,
  complete = false,
  highlight = false,
  dimmed = false,
  failed = false,
  terminal = false,
}: {
  centre: { x: number; y: number };
  icon: React.ReactNode;
  tint: string;
  r?: number;
  active?: boolean;
  complete?: boolean;
  highlight?: boolean;
  dimmed?: boolean;
  failed?: boolean;
  terminal?: boolean;
}) {
  const classes = [
    styles.badge,
    active ? styles.badgeActive : "",
    complete && !failed ? styles.badgeComplete : "",
    highlight ? styles.badgeHighlight : "",
    dimmed ? styles.badgeDim : "",
    failed ? styles.badgeFailed : "",
    terminal && complete && !failed ? styles.badgeTerminalOk : "",
    terminal && failed ? styles.badgeTerminalFail : "",
    !active && !complete && !highlight && !dimmed ? styles.badgeUpcoming : "",
  ]
    .filter(Boolean)
    .join(" ");
  const bg = active
    ? `radial-gradient(circle at 35% 28%, ${tint}66, ${tint}1f 55%, var(--bg-inset) 78%)`
    : complete
      ? `radial-gradient(circle at 35% 30%, ${tint}44, transparent 68%), var(--bg-inset)`
      : `radial-gradient(circle at 35% 30%, ${tint}22, transparent 70%), var(--bg-inset)`;
  return (
    <div
      style={{
        ...badgeStyle(centre, r),
        background: bg,
        borderColor: active ? tint : `${tint}88`,
        boxShadow: active
          ? `0 0 0 1.5px ${tint}, 0 0 22px ${tint}aa, inset 0 0 12px ${tint}55`
          : undefined,
        ["--stage-tint" as string]: tint,
      }}
      className={classes}
    >
      {icon}
    </div>
  );
}

function StageLabel({
  centre,
  step,
  title,
  accent,
  below = false,
}: {
  centre: { x: number; y: number };
  step: string;
  title: string;
  accent?: string;
  below?: boolean;
}) {
  return (
    <div style={labelStyle(centre, 176, below ? 40 : -62)} className={styles.stageLabel}>
      {step ? <span className={styles.stageStep}>{step}</span> : null}
      <span className={styles.stageTitle} style={accent ? { color: accent } : undefined}>
        {title}
      </span>
    </div>
  );
}

