import type { TelemetryEvent } from "../../types/index.js";
import type { Environment } from "../../lib/env.js";
import type { StreamConnectionState } from "../../lib/sse/connect-stream.js";
import { KpiRow } from "../control-plane/KpiRow.js";
import { EvaluationBreakdownTable } from "../control-plane/EvaluationBreakdownTable.js";
import { ModelComparisonRadar } from "../control-plane/ModelComparisonRadar.js";
import { InfrastructureTelemetryStrip } from "../control-plane/InfrastructureTelemetryStrip.js";
import { LiveEventStreamFooter } from "../control-plane/LiveEventStreamFooter.js";
import styles from "./SupportCluster.module.css";

export function SupportCluster({
  event,
  env,
  latestEvent,
  connection,
}: {
  event: TelemetryEvent;
  env: Environment;
  latestEvent: TelemetryEvent | null;
  connection: StreamConnectionState;
}) {
  return (
    <section className={styles.cluster} aria-label="Supporting telemetry">
      <KpiRow event={event} />
      <div className={styles.split}>
        <EvaluationBreakdownTable event={event} />
        <ModelComparisonRadar event={event} />
      </div>
      <InfrastructureTelemetryStrip event={event} env={env} />
      <LiveEventStreamFooter latest={latestEvent} connection={connection} />
    </section>
  );
}
