"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, GitCompareArrows } from "lucide-react";

import { AppShell } from "../../components/shell/AppShell.js";
import { Mono, ProviderLogo } from "../../components/primitives/index.js";
import { getEnvironment } from "../../lib/env.js";
import { formatRelativeTime, formatClockTime, formatUsd, abbreviateId } from "../../lib/format.js";
import { listTelemetryEvents } from "../../lib/api/telemetry.js";
import type { CandidateScore, RationaleEntry, RoutingDecision, TelemetryEvent } from "../../types/index.js";
import { decisionSourceMeta, type Semantic } from "../routing-explorer/event-presenters.js";
import type { Async } from "../overview/overview-model.js";
import { useReplay, type ReplayState } from "./useReplay.js";
import { deriveReplayComparison, formatRoute, type ReplayComparison } from "./replay-model.js";
import styles from "./Replay.module.css";

export function ReplayView() {
  const env = useMemo(() => getEnvironment(), []);
  const params = useSearchParams();
  const eventId = params.get("eventId");
  const { state, refresh } = useReplay(eventId);

  const connection =
    state.status === "loading" ? "connecting" : state.status === "error" ? "error" : "idle";

  return (
    <AppShell
      connection={connection}
      envLabel={env.envLabel}
      healthy={state.status !== "error"}
      version={env.appVersion}
      activeKey="Replay"
    >
      <div className={styles.page}>
        <header className={styles.head}>
          <div className={styles.kicker}>Replay</div>
          <h1 className={styles.title}>Decision Replay</h1>
          <p className={styles.subtitle}>
            Re-runs the router against the current catalog to check whether a recorded routing decision
            would still be made. Read-only — no providers are called and no telemetry is written.
          </p>
        </header>

        {eventId ? (
          <ResultSection eventId={eventId} state={state} refresh={refresh} />
        ) : (
          <Picker {...(env.apiKey ? { apiKey: env.apiKey } : {})} />
        )}
      </div>
    </AppShell>
  );
}

function Picker({ apiKey }: { apiKey?: string }) {
  const [events, setEvents] = useState<Async<TelemetryEvent[]>>({ status: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    listTelemetryEvents({ limit: 25, ...(apiKey ? { apiKey } : {}), signal: ctrl.signal })
      .then((res) => setEvents({ status: "ready", data: res.events }))
      .catch((err) => {
        if (!ctrl.signal.aborted)
          setEvents({ status: "error", message: err instanceof Error ? err.message : "Telemetry unavailable" });
      });
    return () => ctrl.abort();
  }, [apiKey]);

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <span>Select a request to replay</span>
        <Link href="/traffic" className={styles.inlineLink}>
          Open Routing Explorer <ArrowRight size={12} aria-hidden />
        </Link>
      </div>
      {events.status === "loading" ? (
        <div className={styles.skelStack}>
          {Array.from({ length: 6 }, (_, i) => <div key={i} className={styles.skelBar} />)}
        </div>
      ) : events.status === "error" ? (
        <div className={styles.stateError} role="alert">
          <AlertTriangle size={14} aria-hidden /> {events.message}
        </div>
      ) : events.data.length === 0 ? (
        <div className={styles.empty}>No routing events yet.</div>
      ) : (
        <div className={styles.reqList}>
          {events.data.map((e) => {
            const dec = decisionSourceMeta(e.decisionSource);
            return (
              <Link key={e.eventId} href={`/replay?eventId=${encodeURIComponent(e.eventId)}`} className={styles.reqRow}>
                <span className={styles.reqTime} title={formatClockTime(e.receivedAt)}>{formatRelativeTime(e.receivedAt)}</span>
                <span className={styles.reqModel}>{e.effectiveProviderId}:{e.effectiveModelId}</span>
                <Badge meta={dec} />
                <span className={styles.reqId} title={e.eventId}>{abbreviateId(e.eventId, 12)}</span>
                <span className={styles.reqMetric}>{formatUsd(e.estimatedCostUsd)}</span>
                <ArrowRight size={13} className={styles.reqArrow} aria-hidden />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ResultSection({ eventId, state, refresh }: { eventId: string; state: ReplayState; refresh: () => void }) {
  return (
    <>
      <Link href="/replay" className={styles.back}>
        <ArrowLeft size={14} aria-hidden /> Choose another request
      </Link>
      <div className={styles.eventLine}>
        <span className={styles.eventLabel}>Event</span>
        <Mono size={12} color="var(--text-secondary)">{eventId}</Mono>
      </div>

      {state.status === "loading" ? (
        <div className={styles.skelStack}>
          {Array.from({ length: 3 }, (_, i) => <div key={i} className={styles.skelBar} style={{ height: 120 }} />)}
        </div>
      ) : state.status === "notFound" ? (
        <div className={styles.empty}>
          <div className={styles.stateTitle}>Event not found</div>
          <div className={styles.stateBody}>No telemetry event exists for this id. It may have aged out of the retention window.</div>
          <Link href="/replay" className={styles.ghostBtn}>Back to picker</Link>
        </div>
      ) : state.status === "error" ? (
        <div className={styles.stateError} role="alert">
          <AlertTriangle size={16} aria-hidden />
          <div>
            <div className={styles.stateTitle}>Couldn’t load replay</div>
            <div className={styles.stateBody}>{state.message}</div>
          </div>
          <button type="button" className={styles.ghostBtn} onClick={refresh}>Retry</button>
        </div>
      ) : state.status === "ready" ? (
        <ReplayResultBody comparison={deriveReplayComparison(state.result)} />
      ) : null}
    </>
  );
}

function ReplayResultBody({ comparison }: { comparison: ReplayComparison }) {
  const { recorded, replayed, kind, drift } = comparison;
  const recordedRoute = formatRoute(recorded);
  const replayedRoute = formatRoute(replayed);

  return (
    <>
      <StatusBanner comparison={comparison} recordedRoute={recordedRoute} replayedRoute={replayedRoute} />

      <div className={styles.grid2}>
        <DecisionPanel title="Recorded decision" decision={recorded} />
        {kind === "error" ? (
          <div className={styles.decisionPanel}>
            <div className={styles.decisionHead}>Current replay</div>
            <div className={styles.replayErrorBox} role="alert">
              <AlertTriangle size={14} aria-hidden />
              <div>
                <div className={styles.stateTitle}>Replay could not be computed</div>
                <div className={styles.stateBody}>{comparison.replayError ?? "The router did not return a replayed decision."}</div>
              </div>
            </div>
          </div>
        ) : (
          <DecisionPanel title="Current replay" decision={replayed} highlightDrift={drift} />
        )}
      </div>

      <div className={styles.grid2}>
        <CandidatePanel title="Recorded candidates" candidates={recorded.candidateRanking} />
        {kind === "error" ? (
          <div className={styles.panel}>
            <div className={styles.panelHead}><span>Replay candidates</span></div>
            <div className={styles.empty}>Not available — replay did not complete.</div>
          </div>
        ) : (
          <CandidatePanel title="Replay candidates" candidates={replayed?.candidateRanking ?? []} />
        )}
      </div>

      <div className={styles.grid2}>
        <RationalePanel title="Recorded rationale" rationale={recorded.rationale} />
        {kind === "error" ? (
          <div className={styles.panel}>
            <div className={styles.panelHead}><span>Replay rationale</span></div>
            <div className={styles.empty}>Not available — replay did not complete.</div>
          </div>
        ) : (
          <RationalePanel title="Replay rationale" rationale={replayed?.rationale ?? []} />
        )}
      </div>
    </>
  );
}

function StatusBanner({
  comparison,
  recordedRoute,
  replayedRoute,
}: {
  comparison: ReplayComparison;
  recordedRoute: string;
  replayedRoute: string;
}) {
  const { kind, drift } = comparison;
  if (kind === "error") {
    return (
      <div className={`${styles.banner} ${styles.bannerError}`} role="status">
        <AlertTriangle size={16} aria-hidden />
        <div>
          <div className={styles.bannerTitle}>Replay error</div>
          <div className={styles.bannerBody}>The router could not re-evaluate this decision. The recorded decision is shown below; no replayed route was produced.</div>
        </div>
      </div>
    );
  }
  if (kind === "passthrough") {
    return (
      <div className={`${styles.banner} ${styles.bannerInfo}`} role="status">
        <CheckCircle2 size={16} aria-hidden />
        <div>
          <div className={styles.bannerTitle}>Deterministic passthrough</div>
          <div className={styles.bannerBody}>Replay preserved the recorded decision because this decision source is deterministic. The rule/override was not re-evaluated in the browser.</div>
        </div>
      </div>
    );
  }
  if (drift) {
    return (
      <div className={`${styles.banner} ${styles.bannerDrift}`} role="status">
        <GitCompareArrows size={16} aria-hidden />
        <div>
          <div className={styles.bannerTitle}>Drift</div>
          <div className={styles.bannerBody}>
            Recorded decision and current replay selected different routes. Recorded{" "}
            <Mono size={11} color="var(--text-primary)">{recordedRoute}</Mono> · replay{" "}
            <Mono size={11} color="var(--text-primary)">{replayedRoute}</Mono>.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={`${styles.banner} ${styles.bannerMatch}`} role="status">
      <CheckCircle2 size={16} aria-hidden />
      <div>
        <div className={styles.bannerTitle}>Match</div>
        <div className={styles.bannerBody}>Current replay selected the same route as recorded (<Mono size={11} color="var(--text-primary)">{recordedRoute}</Mono>).</div>
      </div>
    </div>
  );
}

function DecisionPanel({
  title,
  decision,
  highlightDrift,
}: {
  title: string;
  decision: RoutingDecision | null;
  highlightDrift?: boolean;
}) {
  return (
    <div className={highlightDrift ? `${styles.decisionPanel} ${styles.decisionDrift}` : styles.decisionPanel}>
      <div className={styles.decisionHead}>{title}</div>
      {decision === null ? (
        <div className={styles.empty}>No decision available.</div>
      ) : (
        <>
          <div className={styles.routeRow}>
            <ProviderLogo providerId={decision.chosenProviderId} modelId={decision.chosenModelId} size={18} variant="bare" />
            <Mono size={13} color="var(--text-primary)">{decision.chosenProviderId}:{decision.chosenModelId}</Mono>
          </div>
          <div className={styles.decisionMeta}>
            <Badge meta={decisionSourceMeta(decision.decisionSource)} />
          </div>
          <dl className={styles.factList}>
            <Fact label="Estimated cost" value={formatUsd(decision.estimatedCostUsd)} />
            <Fact label="Pricing version" value={decision.pricingTableVersionId} mono />
          </dl>
        </>
      )}
    </div>
  );
}

function CandidatePanel({ title, candidates }: { title: string; candidates: readonly CandidateScore[] }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}><span>{title}</span></div>
      {candidates.length === 0 ? (
        <div className={styles.empty}>No candidates recorded.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Route</th>
                <th>Included</th>
                <th className={styles.num}>Score</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={`${c.providerId}:${c.modelId}`} className={c.included ? undefined : styles.excludedRow}>
                  <td className={styles.mono} title={`${c.providerId}:${c.modelId}`}>{c.providerId}:{c.modelId}</td>
                  <td>
                    {c.included ? (
                      <span className={styles.inYes}>included</span>
                    ) : (
                      <span className={styles.inNo} title={c.exclusionReason ?? undefined}>excluded</span>
                    )}
                  </td>
                  <td className={styles.num}>{fmtScore(c.scoreBreakdown["total"])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RationalePanel({ title, rationale }: { title: string; rationale: readonly RationaleEntry[] }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}><span>{title}</span></div>
      {rationale.length === 0 ? (
        <div className={styles.empty}>No rationale recorded.</div>
      ) : (
        <ul className={styles.rationaleList}>
          {rationale.map((r, i) => (
            <li key={i} className={styles.rationaleItem}>
              <span className={styles.verdictTag} data-verdict={r.verdict}>{r.verdict}</span>
              <span className={styles.rationaleFactor}>{r.factor}</span>
              {r.note ? <span className={styles.rationaleNote}>{r.note}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={mono ? styles.factValueMono : styles.factValue}>{value}</dd>
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

function fmtScore(v: number | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(3) : "—";
}
