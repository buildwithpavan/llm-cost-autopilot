"use client";
import { useMemo } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { DecisionGraphPanel } from "@/features/decision-graph/DecisionGraphPanel";
import { SupportCluster } from "@/features/support-cluster/SupportCluster";
import { DevRequestTrigger } from "@/components/dev/DevRequestTrigger";
import { useTelemetryEvent } from "@/hooks/useTelemetryEvent";
import { useLiveEventStream } from "@/hooks/useLiveEventStream";
import { buildCandidateViews } from "@/features/decision-graph/build-decision-graph";
import { getEnvironment } from "@/lib/env";
import styles from "./routing.module.css";

export default function RoutingPage() {
  const env = useMemo(() => getEnvironment(), []);
  const query = useTelemetryEvent();
  const { graph, connection, lastLatest } = useLiveEventStream();

  const seedEvent = query.status === "ready" ? query.event : null;

  // Prefer the live in-flight event; fall back to the last completed live event;
  // otherwise use whatever the seed query returned (backend or fixture).
  const liveInFlight = graph.eventId !== null;
  const displayEvent = graph.fullEvent ?? lastLatest ?? seedEvent;

  const candidates = useMemo(() => {
    if (liveInFlight && graph.candidates.length > 0) return graph.candidates;
    return displayEvent ? buildCandidateViews(displayEvent) : [];
  }, [liveInFlight, graph.candidates, displayEvent]);

  const timeline = graph.timeline;

  return (
    <AppShell
      connection={connection}
      envLabel={env.envLabel}
      healthy={connection === "live"}
      version={env.appVersion}
    >
      <div className={styles.actions}>
        <DevRequestTrigger {...(env.apiKey ? { apiKey: env.apiKey } : {})} />
      </div>
      {!displayEvent ? (
        query.status === "loading" ? (
          <LoadingState />
        ) : (
          <EmptyState connection={connection} />
        )
      ) : (
        <div className={styles.stage}>
          <DecisionGraphPanel
            event={displayEvent}
            candidates={candidates}
            timeline={timeline}
            edges={graph.edges}
            connection={connection}
            graph={graph}
          />
          <SupportCluster
            event={displayEvent}
            env={env}
            latestEvent={graph.fullEvent ?? lastLatest ?? null}
            connection={connection}
          />
        </div>
      )}
      {query.status === "ready" && query.source === "fixture" && !liveInFlight ? (
        <div className={styles.fixtureBanner} role="status">
          <span className={styles.fixtureDot} aria-hidden />
          Backend unreachable — rendering reference-match fixture. Point{" "}
          <code>NEXT_PUBLIC_LCA_API_BASE_URL</code> at a live API and use{" "}
          <code>NEXT_PUBLIC_LCA_DEV_MODE=1</code> plus <code>NEXT_PUBLIC_LCA_API_KEY</code> to
          watch a real request travel through the graph.
        </div>
      ) : null}
    </AppShell>
  );
}

function LoadingState() {
  return (
    <div className={styles.state}>
      <div className={styles.spinner} aria-hidden />
      <span>Waiting for telemetry…</span>
    </div>
  );
}

function EmptyState({ connection }: { connection: string }) {
  return (
    <div className={styles.state}>
      <span>No telemetry yet.</span>
      <code style={{ fontSize: 11, color: "var(--text-secondary)" }}>
        stream: {connection}
      </code>
    </div>
  );
}
