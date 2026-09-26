"use client";
import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Activity, ShieldCheck, DollarSign } from "lucide-react";

import { AppShell } from "../../components/shell/AppShell.js";
import { getEnvironment } from "../../lib/env.js";
import { DecisionGraphPanel } from "../decision-graph/DecisionGraphPanel.js";
import { buildCandidateViews, buildTimelineFromEvent } from "../decision-graph/build-decision-graph.js";
import { initialGraphState } from "../live-graph/graph-reducer.js";
import { decisionSourceMeta, statusMeta, type Semantic } from "../routing-explorer/event-presenters.js";
import { formatUsd, formatMs, formatClockTime, formatRelativeTime } from "../../lib/format.js";
import type { TelemetryEvent } from "../../types/index.js";
import type { ReconciliationMetrics } from "../../lib/api/metrics.js";
import { useOverviewData } from "./useOverviewData.js";
import type { SectionState, TrafficPulse, ProviderStrip, PricingSummary } from "./overview-model.js";
import styles from "./Overview.module.css";

export function OverviewView() {
  const env = useMemo(() => getEnvironment(), []);
  const { sections, health } = useOverviewData();

  const healthy = health.status === "ready" && health.data.status === "ok";
  const connection =
    health.status === "loading" ? "connecting" : health.status === "error" ? "error" : "idle";

  const latestEvent =
    sections.latest.kind === "ready" ? sections.latest.data[0] ?? null : null;

  return (
    <AppShell
      connection={connection}
      envLabel={env.envLabel}
      healthy={healthy}
      version={env.appVersion}
      activeKey="Overview"
    >
      <div className={styles.page}>
        <header className={styles.head}>
          <div className={styles.kicker}>Overview</div>
          <h1 className={styles.title}>Routing at a glance</h1>
          <p className={styles.subtitle}>
            Live posture across traffic, providers, cost reconciliation, and the latest routing decisions.
          </p>
        </header>

        <div className={styles.grid}>
          <TrafficPulseCard section={sections.trafficPulse} />
          <ReconciliationCard section={sections.reconciliation} />
          <PricingCard section={sections.pricing} />
        </div>

        <ProviderStripCard section={sections.providerStrip} />

        <div className={styles.sectionTitle}>Latest routing decision</div>
        {latestEvent ? (
          <MiniTrace event={latestEvent} />
        ) : (
          <div className={styles.panel}>
            <SectionFallback section={sections.latest} emptyLabel="No routing decisions recorded yet." />
          </div>
        )}

        <div className={styles.sectionTitle}>Latest requests</div>
        <div className={styles.panel}>
          <LatestRequests section={sections.latest} />
        </div>

        <div className={styles.sectionTitle}>Jump in</div>
        <div className={styles.actions}>
          <ActionCard href="/traffic" icon={<Activity size={16} aria-hidden />} title="Routing Explorer"
            body="Filter and investigate historical requests." />
          <ActionCard href="/routing" icon={<ArrowRight size={16} aria-hidden />} title="AI Routing Trace"
            body="Watch routing decisions stream live." />
        </div>
      </div>
    </AppShell>
  );
}

function MiniTrace({ event }: { event: TelemetryEvent }) {
  const candidates = useMemo(() => buildCandidateViews(event), [event]);
  const timeline = useMemo(() => buildTimelineFromEvent(event), [event]);
  const graph = useMemo(() => initialGraphState(), []);
  return (
    <>
      <div className={styles.miniTraceMeta}>
        <span className={styles.mono}>{event.eventId}</span>
        <Link href={`/traffic/${event.eventId}`} className={styles.inlineLink}>
          Open detail <ArrowRight size={12} aria-hidden />
        </Link>
      </div>
      <DecisionGraphPanel
        event={event}
        candidates={candidates}
        timeline={timeline}
        edges={graph.edges}
        connection="idle"
        graph={graph}
      />
    </>
  );
}

function TrafficPulseCard({ section }: { section: SectionState<TrafficPulse> }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <Activity size={13} color="var(--accent-primary)" aria-hidden />
        Traffic pulse
      </div>
      {section.kind === "ready" ? (
        <>
          <div className={styles.bigStat}>{section.data.total}</div>
          <div className={styles.statLabel}>
            requests{" "}
            {section.data.spanMinutes >= 0.5
              ? `· ${section.data.perMinute.toFixed(1)}/min over ${section.data.spanMinutes.toFixed(0)}m`
              : "· latest window"}
          </div>
          <div className={styles.statRows}>
            <Stat label="Autopilot" value={pct(section.data.autopilotShare)} />
            <Stat label="Overridden" value={pct(section.data.overrideShare)} />
            <Stat
              label="Failed"
              value={pct(section.data.failureRate)}
              {...(section.data.failed > 0 ? { tone: "warn" as const } : {})}
            />
          </div>
          <div className={styles.footNote}>Derived from persisted telemetry (no request-rate metric is emitted).</div>
        </>
      ) : (
        <SectionFallback section={section} emptyLabel="No requests recorded yet." />
      )}
    </div>
  );
}

function ReconciliationCard({ section }: { section: SectionState<ReconciliationMetrics> }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <ShieldCheck size={13} color="var(--success)" aria-hidden />
        Reconciliation
      </div>
      {section.kind === "ready" ? (
        section.data.rate === null ? (
          <div className={styles.unavailable}>Not reported yet — no reconciliation samples.</div>
        ) : (
          <>
            <div className={styles.bigStat}>{(section.data.rate * 100).toFixed(1)}%</div>
            <div className={styles.statLabel}>rolling reconciled rate</div>
            <div className={styles.reconAlert}>
              {section.data.alertActive === null ? (
                <span className={styles.unavailableInline}>alert state unavailable</span>
              ) : section.data.alertActive ? (
                <span className={styles.alertOn}>drift alert active</span>
              ) : (
                <span className={styles.alertOff}>within tolerance</span>
              )}
            </div>
          </>
        )
      ) : (
        <SectionFallback section={section} emptyLabel="No reconciliation data." />
      )}
    </div>
  );
}

function PricingCard({ section }: { section: SectionState<PricingSummary> }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <DollarSign size={13} color="var(--accent-cyan)" aria-hidden />
        Active pricing
      </div>
      {section.kind === "ready" ? (
        <>
          <div className={styles.versionStat}>{section.data.versionId}</div>
          <div className={styles.statLabel}>active pricing-table version</div>
          <div className={styles.footNote}>Effective-since timestamp is not exposed by the catalog API.</div>
        </>
      ) : (
        <SectionFallback section={section} emptyLabel="No active pricing table." />
      )}
    </div>
  );
}

function ProviderStripCard({ section }: { section: SectionState<ProviderStrip> }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>Provider availability</div>
      {section.kind === "ready" ? (
        <>
          <div className={styles.chips}>
            {section.data.providers.map((p) => (
              <span key={p} className={styles.providerChip}>
                <span className={styles.dotOk} aria-hidden /> {p}
              </span>
            ))}
          </div>
          <div className={styles.footNote}>
            {section.data.availableCount} healthy provider{section.data.availableCount === 1 ? "" : "s"} in the catalog
            {section.data.unhealthyCount !== null && section.data.unhealthyCount > 0
              ? ` · ${section.data.unhealthyCount} unhealthy (excluded from routing; not individually exposed)`
              : ""}
            .
          </div>
        </>
      ) : (
        <SectionFallback section={section} emptyLabel="No providers in the catalog." />
      )}
    </div>
  );
}

function LatestRequests({ section }: { section: SectionState<readonly TelemetryEvent[]> }) {
  if (section.kind !== "ready") {
    return <SectionFallback section={section} emptyLabel="No requests recorded yet." />;
  }
  return (
    <div className={styles.reqList}>
      {section.data.map((e) => {
        const dec = decisionSourceMeta(e.decisionSource);
        const st = statusMeta(e);
        return (
          <Link key={e.eventId} href={`/traffic/${e.eventId}`} className={styles.reqRow}>
            <span className={styles.reqTime} title={formatClockTime(e.receivedAt)}>
              {formatRelativeTime(e.receivedAt)}
            </span>
            <span className={styles.reqModel}>{e.effectiveModelId}</span>
            <Badge meta={dec} />
            <Badge meta={st} />
            <span className={styles.reqMetric}>{formatMs(e.totalLatencyMs)}</span>
            <span className={styles.reqMetric}>{formatUsd(e.estimatedCostUsd)}</span>
            <ArrowRight size={13} className={styles.reqArrow} aria-hidden />
          </Link>
        );
      })}
    </div>
  );
}

function ActionCard({ href, icon, title, body }: { href: string; icon: React.ReactNode; title: string; body: string }) {
  return (
    <Link href={href} className={styles.actionCard}>
      <div className={styles.actionIcon}>{icon}</div>
      <div>
        <div className={styles.actionTitle}>{title}</div>
        <div className={styles.actionBody}>{body}</div>
      </div>
    </Link>
  );
}

function SectionFallback({ section, emptyLabel }: { section: SectionState<unknown>; emptyLabel: string }) {
  if (section.kind === "loading") return <div className={styles.skelBar} style={{ height: 40 }} />;
  if (section.kind === "error") {
    return (
      <div className={styles.sectionError} role="alert">
        <AlertTriangle size={14} aria-hidden /> {section.message}
      </div>
    );
  }
  return <div className={styles.empty}>{emptyLabel}</div>;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className={styles.statRow}>
      <span className={styles.statRowLabel}>{label}</span>
      <span className={tone === "warn" ? styles.statWarn : styles.statRowValue}>{value}</span>
    </div>
  );
}

function Badge({ meta }: { meta: Semantic }) {
  return (
    <span className={styles.badge} style={{ color: meta.color, background: meta.bg, border: `1px solid ${meta.border}` }}>
      {meta.label}
    </span>
  );
}

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}
