"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "../../components/shell/AppShell.js";
import { getEnvironment } from "../../lib/env.js";
import { DecisionGraphPanel } from "../decision-graph/DecisionGraphPanel.js";
import { buildCandidateViews, buildTimelineFromEvent } from "../decision-graph/build-decision-graph.js";
import { initialGraphState } from "../live-graph/graph-reducer.js";
import { CandidateRow } from "../control-plane/CandidatesMiniList.js";
import { useRoutingEventById } from "./useRoutingEventById.js";
import {
  decisionSourceMeta,
  statusMeta,
  reconciliationState,
  reconciliationMeta,
  type Semantic,
} from "./event-presenters.js";
import type { Attempt, RationaleEntry, TelemetryEvent } from "../../types/index.js";
import { formatUsd, formatMs, formatInt, formatClockTime, formatRelativeTime } from "../../lib/format.js";
import { AlertTriangle, ArrowLeft, ArrowRight, ArrowDown, Copy, Check } from "lucide-react";
import styles from "./RoutingExplorer.module.css";

const NOT_RECORDED = "Not recorded";

// Semantic hues from the design language (§ Visual language), used only for the
// section-hierarchy accents; the AI Routing Trace remains the canonical visual.
const SECTION_ROUTER = "#2dd4bf";
const SECTION_EXECUTION = "#6366f1";
const SECTION_RESULT = "#34d399";

export function RequestDetailView({ eventId }: { eventId: string }) {
  const env = useMemo(() => getEnvironment(), []);
  const state = useRoutingEventById(eventId, env.apiKey);

  const connection =
    state.status === "loading" ? "connecting" : state.status === "error" ? "error" : "idle";

  return (
    <AppShell
      connection={connection}
      envLabel={env.envLabel}
      healthy={state.status === "ready"}
      version={env.appVersion}
      activeKey="Traffic"
    >
      <div className={styles.page}>
        <Link href="/traffic" className={styles.detailBack}>
          <ArrowLeft size={14} aria-hidden />
          Routing Explorer
        </Link>

        {state.status === "loading" ? (
          <DetailSkeleton />
        ) : state.status === "error" ? (
          <div className={styles.state} role="alert">
            <AlertTriangle size={24} className={styles.stateIcon} aria-hidden />
            <div className={styles.stateTitle}>Couldn’t load this request</div>
            <div className={styles.stateBody}>{state.message}</div>
          </div>
        ) : state.status === "notFound" ? (
          <div className={styles.state}>
            <div className={styles.stateTitle}>Request not found</div>
            <div className={styles.stateBody}>
              This request may have aged out of the available telemetry window.
              <br />
              <span className={styles.mono}>{eventId}</span>
            </div>
          </div>
        ) : (
          <RequestDetailBody event={state.event} />
        )}
      </div>
    </AppShell>
  );
}

function RequestDetailBody({ event }: { event: TelemetryEvent }) {
  const dec = decisionSourceMeta(event.decisionSource);
  const st = statusMeta(event);
  const rec = reconciliationMeta(reconciliationState(event));

  const candidates = useMemo(() => buildCandidateViews(event), [event]);
  const timeline = useMemo(() => buildTimelineFromEvent(event), [event]);
  const graph = useMemo(() => initialGraphState(), []);

  // Selected (router pick) vs actually executed (last successful attempt).
  const selectedModelId = event.routingRationale.chosenModelId;
  const executedAttempt =
    [...event.attempts].reverse().find((a) => a.errorClass === "none") ??
    event.attempts[event.attempts.length - 1];
  const executedModelId = executedAttempt?.modelId ?? event.effectiveModelId;
  const isFallback = event.attempts.length > 1;
  const afterFallback = isFallback && executedModelId !== selectedModelId;
  const isOperatorRule = event.decisionSource === "operator_rule";

  return (
    <>
      <div className={styles.detailHead}>
        <div>
          <div className={styles.detailKicker}>Request Detail</div>
          <div className={styles.idRow}>
            <span className={styles.detailId}>{event.eventId}</span>
            <CopyButton text={event.eventId} />
          </div>
        </div>
        <Badge meta={st} />
      </div>

      <div className={styles.summaryChips}>
        <Summary label="Status">
          <Badge meta={st} />
        </Summary>
        <Summary label="Decision">
          <Badge meta={dec} />
        </Summary>
        <Summary label="Model">{executedModelId}</Summary>
        <Summary label="Latency">{formatMs(event.totalLatencyMs)}</Summary>
        <Summary label="Est. cost">{formatUsd(event.estimatedCostUsd)}</Summary>
      </div>

      {/* Hero — the canonical AI Routing Trace, reused unchanged. */}
      <DecisionGraphPanel
        event={event}
        candidates={candidates}
        timeline={timeline}
        edges={graph.edges}
        connection="idle"
        graph={graph}
      />

      <div className={styles.panel}>
        <div className={styles.panelHeading}>Request overview</div>
        <div className={styles.factGrid}>
          <Fact label="Received">
            {formatClockTime(event.receivedAt)}{" "}
            <span style={{ color: "var(--text-tertiary)" }}>· {formatRelativeTime(event.receivedAt)}</span>
          </Fact>
          <Fact label="Client">{event.clientId}</Fact>
          <Fact label="Decision source">
            <Badge meta={dec} />
          </Fact>
          <Fact label="Shadowed source">
            {event.shadowedSource ? event.shadowedSource.replace(/_/g, " ") : "—"}
          </Fact>
          <Fact label="Effective model">{event.effectiveModelId}</Fact>
          <Fact label="Pricing table">{event.pricingTableVersionId}</Fact>
        </div>
      </div>

      <SectionTitle accent={SECTION_ROUTER}>Routing decision</SectionTitle>
      <div className={styles.detailGrid}>
        <div className={styles.panel}>
          <div className={styles.panelHeading}>Selected vs executed</div>
          <div className={styles.execFlow}>
            <div className={styles.execNode}>
              <div className={styles.execNodeLabel}>Router selected</div>
              <div className={styles.execNodeModel}>{selectedModelId}</div>
            </div>
            <ArrowRight size={16} className={styles.execArrow} aria-hidden />
            <div className={`${styles.execNode} ${afterFallback ? styles.execFallback : ""}`.trim()}>
              <div className={styles.execNodeLabel}>Executed</div>
              <div className={styles.execNodeModel}>{executedModelId}</div>
              {afterFallback ? <span className={styles.execFallbackTag}>after fallback</span> : null}
            </div>
          </div>
          {isOperatorRule ? (
            <div className={styles.bypassNote}>Operator rule · autonomous evaluation bypassed</div>
          ) : event.decisionSource === "client_override" ? (
            <div className={styles.bypassNote}>
              Client override
              {event.shadowedSource ? ` · shadowed ${event.shadowedSource.replace(/_/g, " ")}` : ""}
            </div>
          ) : null}
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeading}>Candidates considered</div>
          <div className={styles.candidateList}>
            {candidates.map((c) => (
              <CandidateRow key={`${c.providerId}:${c.modelId}`} candidate={c} showReason />
            ))}
          </div>
        </div>
      </div>

      <SectionTitle accent={SECTION_EXECUTION}>Execution &amp; performance</SectionTitle>
      <div className={styles.detailGrid}>
        <div className={styles.panel}>
          <div className={styles.panelHeading}>Attempt chain</div>
          <div className={styles.attemptFlow}>
            {event.attempts.map((a, i) => {
              const prev = i > 0 ? event.attempts[i - 1] : null;
              return (
                <div key={a.attemptIndex}>
                  {prev ? (
                    <div className={styles.attemptConnector}>
                      <ArrowDown size={12} aria-hidden />
                      <span>
                        single automatic fallback · triggered by{" "}
                        <span className={styles.attemptTrigger}>{prev.errorClass.replace(/_/g, " ")}</span>{" "}
                        (FR-033)
                      </span>
                    </div>
                  ) : null}
                  <AttemptCard attempt={a} fallback={a.attemptIndex > 0} />
                </div>
              );
            })}
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeading}>Performance &amp; cost</div>
          <div className={styles.factGrid}>
            <Fact label="Total latency">{formatMs(event.totalLatencyMs)}</Fact>
            <Fact label="Input tokens">{formatInt(event.aggregatedInputTokens)}</Fact>
            <Fact label="Output tokens">{formatInt(event.aggregatedOutputTokens)}</Fact>
            <Fact label="Estimated cost">{formatUsd(event.estimatedCostUsd)}</Fact>
            <Fact label="Actual cost">
              {event.actualCostUsd === null ? (
                <span className={styles.notRecorded}>{NOT_RECORDED}</span>
              ) : (
                <>
                  {formatUsd(event.actualCostUsd)}
                  {reconciliationState(event) === "mismatch" ? (
                    <span className={styles.costMismatch}>
                      {" "}
                      Δ {formatUsd(String(Number(event.actualCostUsd) - Number(event.estimatedCostUsd)))}
                    </span>
                  ) : null}
                </>
              )}
            </Fact>
          </div>
        </div>
      </div>

      <SectionTitle accent={SECTION_RESULT}>Outcome</SectionTitle>
      <div className={styles.panel}>
        <div className={styles.factGrid}>
          <Fact label="Status">
            <Badge meta={st} />
          </Fact>
          <Fact label="Terminal error">
            {event.terminalErrorClass === "none" ? "—" : event.terminalErrorClass.replace(/_/g, " ")}
          </Fact>
          <Fact label="Reconciliation">
            <Badge meta={rec} />
          </Fact>
        </div>
      </div>

      {event.routingRationale.rationale.length > 0 ? (
        <div className={styles.panel}>
          <div className={styles.panelHeading}>Decision rationale</div>
          <div className={styles.rationale}>
            {event.routingRationale.rationale.map((r, i) => (
              <RationaleRow key={i} entry={r} />
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function DetailSkeleton() {
  return (
    <>
      <div className={styles.skelBar} style={{ width: 320, height: 22 }} />
      <div className={styles.summaryChips}>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={styles.skelBar} style={{ width: 120, height: 48 }} />
        ))}
      </div>
      <div className={styles.skelBar} style={{ width: "100%", height: 300 }} />
      <div className={styles.panel}>
        <div className={styles.factGrid}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={styles.skelBar} style={{ height: 28 }} />
          ))}
        </div>
      </div>
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={styles.copyBtn}
      aria-label="Copy request id"
      title={copied ? "Copied" : "Copy request id"}
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Check size={13} color="var(--success)" aria-hidden /> : <Copy size={13} aria-hidden />}
    </button>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      <span className={styles.factValue}>{children}</span>
    </div>
  );
}

function Summary({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.summaryChip}>
      <span className={styles.summaryLabel}>{label}</span>
      <span className={styles.summaryValue}>{children}</span>
    </div>
  );
}

function Badge({ meta }: { meta: Semantic }) {
  return (
    <span
      className={styles.badge}
      style={{ color: meta.color, background: meta.bg, border: `1px solid ${meta.border}` }}
    >
      {meta.label}
    </span>
  );
}

function SectionTitle({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <div className={styles.sectionTitle}>
      <span className={styles.sectionDot} style={{ background: accent }} aria-hidden />
      {children}
    </div>
  );
}

function AttemptCard({ attempt: a, fallback }: { attempt: Attempt; fallback: boolean }) {
  const ok = a.errorClass === "none";
  const cls = `${styles.attemptCard} ${
    !ok ? styles.attemptCardFail : fallback ? styles.attemptCardFallback : ""
  }`.trim();
  const tokens =
    a.inputTokens === null && a.outputTokens === null
      ? null
      : `${formatInt(a.inputTokens)} → ${formatInt(a.outputTokens)}`;
  return (
    <div className={cls}>
      <div className={styles.attemptHead}>
        <span className={styles.attemptIdx}>ATTEMPT {a.attemptIndex}</span>
        <span className={styles.attemptModel}>{a.modelId}</span>
        <span
          className={styles.attemptStatus}
          style={{ color: ok ? "var(--success)" : "var(--error)" }}
        >
          {ok ? "success" : a.errorClass.replace(/_/g, " ")}
        </span>
      </div>
      <div className={styles.attemptMetrics}>
        <AttemptMetric label="Latency" value={`${a.latencyMs} ms`} />
        <AttemptMetric label="Tokens" value={tokens} />
        <AttemptMetric label="Est." value={formatUsd(a.estimatedCostUsd)} />
        <AttemptMetric label="Actual" value={a.actualCostUsd === null ? null : formatUsd(a.actualCostUsd)} />
        <AttemptMetric label="Pricing" value={a.pricingTableVersionId} />
      </div>
    </div>
  );
}

function AttemptMetric({ label, value }: { label: string; value: string | null }) {
  return (
    <span className={styles.attemptMetric}>
      <span className={styles.attemptMetricLabel}>{label}</span>
      {value === null ? (
        <span className={styles.notRecorded}>{NOT_RECORDED}</span>
      ) : (
        <span className={styles.attemptMetricValue}>{value}</span>
      )}
    </span>
  );
}

const VERDICT_ACCENT: Record<RationaleEntry["verdict"], string> = {
  preferred: "var(--success)",
  eliminated: "var(--error)",
  neutral: "var(--text-tertiary)",
};

function RationaleRow({ entry: r }: { entry: RationaleEntry }) {
  const accent = VERDICT_ACCENT[r.verdict];
  return (
    <div className={styles.rationaleRow} style={{ borderLeftColor: accent }}>
      <span className={styles.rationaleFactor}>
        <span className={styles.rationaleVerdict} style={{ background: accent }} aria-hidden />
        {r.factor}
      </span>
      <span className={styles.rationaleNote}>{r.note}</span>
    </div>
  );
}
