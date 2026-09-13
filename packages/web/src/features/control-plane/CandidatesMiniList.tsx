import type { CandidateView } from "../decision-graph/decision-graph.types.js";
import styles from "./CandidatesMiniList.module.css";
import { Check, Circle, X } from "lucide-react";
import { resolveModelAccent, resolveProviderFamilyName } from "../../components/primitives/ProviderLogo.js";

// Winners belong to the gold winning route (STAGE_COLORS.model), so the selected
// candidate shares that gold language rather than the model's own accent.
const WINNER_GOLD = "#fbbf24";

/**
 * A single candidate row — the shared candidate visual language used by BOTH the
 * Control Plane candidates list and the Decision Graph branch chips.
 */
export function CandidateRow({
  candidate: c,
  activeSelection = false,
  showReason = false,
}: {
  candidate: CandidateView;
  activeSelection?: boolean;
  showReason?: boolean;
}) {
  const isWinner = c.kind === "winner";
  const accent = isWinner ? WINNER_GOLD : resolveModelAccent(c.providerId, c.modelId);
  const familyName = resolveProviderFamilyName(c.providerId, c.modelId);
  const cls = isWinner ? styles.winner : c.kind === "runnerUp" ? styles.runner : styles.excluded;
  const icon = isWinner ? (
    <Check size={15} strokeWidth={3} color={accent} aria-hidden />
  ) : c.kind === "runnerUp" ? (
    <Circle size={11} strokeWidth={1.5} color="var(--text-secondary)" aria-hidden />
  ) : (
    <X size={14} strokeWidth={2.75} color="var(--error)" aria-hidden />
  );
  const totalColor = isWinner ? accent : c.kind === "runnerUp" ? "var(--text-secondary)" : "var(--error)";
  const rowCls = `${styles.row} ${cls}${isWinner && activeSelection ? ` ${styles.selectedActive}` : ""}`;
  const reason = showReason && c.kind === "excluded" && c.exclusionReason ? c.exclusionReason : null;
  return (
    <div role="listitem" className={rowCls} style={{ ["--row-accent" as string]: accent }}>
      <span className={styles.accentBar} style={{ background: accent }} aria-hidden />
      <div className={styles.text}>
        <span className={styles.model} style={isWinner ? { color: accent } : undefined}>
          {c.modelId}
        </span>
        <span className={styles.provider}>
          {reason ? <span className={styles.reason}>{reason}</span> : familyName}
        </span>
      </div>
      <span className={styles.value} style={{ color: totalColor }}>
        {isWinner ? <span className={styles.winnerTag}>WINNER</span> : null}
        <span>{c.kind === "excluded" ? "excl." : c.score.toFixed(3)}</span>
      </span>
      <span className={styles.mark}>{icon}</span>
    </div>
  );
}

export function CandidatesMiniList({
  candidates,
  activeSelection = false,
}: {
  candidates: CandidateView[];
  activeSelection?: boolean;
}) {
  return (
    <div className={styles.list} role="list" aria-label="Candidates">
      <div className={styles.heading}>Candidates</div>
      {candidates.map((c) => (
        <CandidateRow key={`${c.providerId}:${c.modelId}`} candidate={c} activeSelection={activeSelection} />
      ))}
    </div>
  );
}
