import type { TelemetryEvent } from "../../types/index.js";
import { buildFactorRows } from "../decision-graph/build-decision-graph.js";
import { TrackBar } from "../../components/primitives/TrackBar.js";
import styles from "./EvaluationBreakdownTable.module.css";

export function EvaluationBreakdownTable({ event }: { event: TelemetryEvent }) {
  const rows = buildFactorRows(event);
  const total = event.routingRationale.candidateRanking.find(
    (c) =>
      c.providerId === event.effectiveProviderId &&
      c.modelId === event.effectiveModelId,
  )?.scoreBreakdown["total"] ?? 0;

  return (
    <div className={styles.card}>
      <h4 className={styles.title}>
        Evaluation Breakdown — {event.effectiveProviderId}:{event.effectiveModelId}
      </h4>

      <div className={styles.grid}>
        <div className={styles.hdr}>Factor</div>
        <div className={styles.hdr}>Weight</div>
        <div className={styles.hdr}>Score</div>
        <div className={styles.hdr}>Contribution</div>
        <div className={styles.hdr} />

        {rows.map((r) => (
          <FactorRow key={r.key} label={r.label} weight={r.weight} score={r.score} contribution={r.contribution} color={r.color} />
        ))}

        <div className={styles.totalLabel}>Total</div>
        <div />
        <div />
        <div className={styles.totalValue}>{total.toFixed(4)}</div>
        <div />
      </div>
    </div>
  );
}

function FactorRow({
  label,
  weight,
  score,
  contribution,
  color,
}: {
  label: string;
  weight: number;
  score: number;
  contribution: number;
  color: string;
}) {
  return (
    <>
      <div className={styles.cell}>{label}</div>
      <div className={styles.mono}>{`.${weight.toFixed(2).slice(2)}`}</div>
      <div className={styles.mono}>{score.toFixed(3).replace(/^0/, "")}</div>
      <div className={styles.mono}>{contribution.toFixed(4).replace(/^0/, "")}</div>
      <TrackBar value={contribution} max={weight} color={color} width={58} height={8} />
    </>
  );
}
