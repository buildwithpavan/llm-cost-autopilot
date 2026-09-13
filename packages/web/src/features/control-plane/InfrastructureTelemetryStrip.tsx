import type { TelemetryEvent } from "../../types/index.js";
import type { Environment } from "../../lib/env.js";
import styles from "./InfrastructureTelemetryStrip.module.css";

export function InfrastructureTelemetryStrip({
  event,
  env,
}: {
  event: TelemetryEvent;
  env: Environment;
}) {
  return (
    <section className={styles.strip} aria-label="Infrastructure & Telemetry">
      <h4 className={styles.title}>Infrastructure & Telemetry</h4>
      <div className={styles.grid}>
        <Cell label="Region" value={env.region} />
        <Cell label="Environment" value={env.envLabel} />
        <Cell label="Pricing Table" value={event.pricingTableVersionId} />
        <Cell label="Decision Source" value={event.decisionSource} />
        <Cell label="Shadowed Source" value={event.shadowedSource ?? "none"} />
        <Cell
          label="Reconciled"
          value={event.reconciled ? "true" : event.reconciled === false ? "false" : "—"}
          {...(event.reconciled ? { color: "var(--success)" } : {})}
        />
      </div>
    </section>
  );
}

function Cell({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className={styles.cell}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value} style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}
