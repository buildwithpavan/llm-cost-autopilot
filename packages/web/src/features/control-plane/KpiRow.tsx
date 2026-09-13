import type { TelemetryEvent } from "../../types/index.js";
import { formatUsd, formatMs, formatInt } from "../../lib/format.js";
import styles from "./KpiRow.module.css";
import { DollarSign, Clock, Layers, ArrowDownToLine, Wallet } from "lucide-react";

export function KpiRow({ event }: { event: TelemetryEvent }) {
  return (
    <div className={styles.row}>
      <Kpi
        icon={<DollarSign size={12} strokeWidth={1.75} color="var(--accent-primary)" aria-hidden />}
        label="Cost (est.)"
        value={formatUsd(event.estimatedCostUsd)}
      />
      <Kpi
        icon={<Clock size={12} strokeWidth={1.75} color="var(--accent-blue)" aria-hidden />}
        label="Latency"
        value={formatMs(event.totalLatencyMs)}
      />
      <Kpi
        icon={<Layers size={12} strokeWidth={1.75} color="var(--accent-cyan)" aria-hidden />}
        label="Input Tokens"
        value={formatInt(event.aggregatedInputTokens)}
      />
      <Kpi
        icon={<ArrowDownToLine size={12} strokeWidth={1.75} color="var(--accent-cyan)" aria-hidden />}
        label="Output Tokens"
        value={formatInt(event.aggregatedOutputTokens)}
      />
      <Kpi
        icon={<Wallet size={12} strokeWidth={1.75} color="var(--success)" aria-hidden />}
        label="Total Cost (act.)"
        value={formatUsd(event.actualCostUsd)}
      />
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className={styles.tile}>
      <div className={styles.icon}>{icon}</div>
      <div className={styles.body}>
        <div className={styles.label}>{label}</div>
        <div className={styles.value}>{value}</div>
      </div>
    </div>
  );
}
