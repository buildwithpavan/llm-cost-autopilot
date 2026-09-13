import type { TelemetryEvent } from "../../types/index.js";
import { buildFactorRows } from "./build-decision-graph.js";
import { TrackBar } from "../../components/primitives/TrackBar.js";
import { resolveModelAccent, resolveProviderFamilyName } from "../../components/primitives/ProviderLogo.js";
import styles from "./DecisionDetailsOverlay.module.css";

export function DecisionDetailsOverlay({ event }: { event: TelemetryEvent }) {
  const winner = event.routingRationale.candidateRanking.find(
    (c) =>
      c.included &&
      c.providerId === event.effectiveProviderId &&
      c.modelId === event.effectiveModelId,
  );
  const rows = buildFactorRows(event);
  const total = winner?.scoreBreakdown["total"] ?? 0;
  const accent = resolveModelAccent(event.effectiveProviderId, event.effectiveModelId);
  const familyName = resolveProviderFamilyName(event.effectiveProviderId, event.effectiveModelId);

  return (
    <aside className={styles.card} aria-label="Decision details">
      <h4 className={styles.title}>Decision Details</h4>

      <div className={styles.section}>
        <div className={styles.label}>Selected Model</div>
        <div style={{ display: "flex", alignItems: "stretch", gap: 10 }}>
          <span
            aria-hidden
            style={{
              width: 4,
              borderRadius: 3,
              background: accent,
              boxShadow: `0 0 8px ${accent}`,
              flexShrink: 0,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div
              className={styles.model}
              style={{ fontSize: 15, fontWeight: 700, fontFamily: "var(--font-mono)", color: accent }}
            >
              {event.effectiveModelId}
            </div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "var(--text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {familyName} · {event.effectiveProviderId}
            </div>
          </div>
        </div>
        <div className={styles.chip}>SCORE {total.toFixed(4)}</div>
      </div>

      <div className={styles.section}>
        <div className={styles.headerRow}>
          <span>Factor Contributions</span>
        </div>
        <ul className={styles.factors}>
          {rows.map((r) => (
            <li key={r.key} className={styles.factorRow}>
              <span className={styles.factorDot} style={{ background: r.color }} aria-hidden />
              <span className={styles.factorLabel}>
                {r.label} ({r.weight.toFixed(2)})
              </span>
              <TrackBar
                value={r.contribution}
                max={r.weight}
                color={r.color}
                width={130}
                height={10}
              />
              <span className={styles.factorValue}>{r.contribution.toFixed(4)}</span>
            </li>
          ))}
        </ul>
        <div className={styles.totalRow}>
          <span>Total</span>
          <span className={styles.mono}>{total.toFixed(4)} / 1.000</span>
        </div>
      </div>
    </aside>
  );
}
