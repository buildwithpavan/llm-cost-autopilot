"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, FlaskConical, Info } from "lucide-react";

import { AppShell } from "../../components/shell/AppShell.js";
import { Mono, ProviderLogo } from "../../components/primitives/index.js";
import { getEnvironment } from "../../lib/env.js";
import { formatUsd } from "../../lib/format.js";
import { decisionSourceMeta, type Semantic } from "../routing-explorer/event-presenters.js";
import type { CandidateScore, RationaleEntry, RoutingDecision } from "../../types/index.js";
import { usePreview } from "./usePreview.js";
import {
  CAPABILITIES,
  QUALITY_TIERS,
  buildPreviewRequest,
  emptyPreviewForm,
  hasErrors,
  toggleCapability,
  validatePreviewForm,
  type PreviewFormErrors,
  type PreviewFormState,
  type QualityTier,
} from "./preview-form.js";
import styles from "./Preview.module.css";

export function PreviewView() {
  const env = useMemo(() => getEnvironment(), []);
  const { state, submit } = usePreview();
  const [form, setForm] = useState<PreviewFormState>(() => emptyPreviewForm());
  const [errors, setErrors] = useState<PreviewFormErrors>({});

  const connection = state.status === "loading" ? "connecting" : state.status === "error" ? "error" : "idle";
  const submitting = state.status === "loading";

  function patch(next: Partial<PreviewFormState>) {
    setForm((f) => ({ ...f, ...next }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const found = validatePreviewForm(form);
    setErrors(found);
    if (hasErrors(found)) return;
    submit(buildPreviewRequest(form));
  }

  return (
    <AppShell
      connection={connection}
      envLabel={env.envLabel}
      healthy={state.status !== "error"}
      version={env.appVersion}
      activeKey="Routing"
    >
      <div className={styles.page}>
        <Link href="/routing" className={styles.back}>
          <ArrowLeft size={14} aria-hidden /> Routing
        </Link>
        <header className={styles.head}>
          <div className={styles.kicker}>Routing</div>
          <h1 className={styles.title}>What-if Routing</h1>
          <p className={styles.subtitle}>
            Preview how the routing engine would handle a request without sending it to a provider.
          </p>
        </header>

        <div className={styles.notice} role="note">
          <Info size={14} aria-hidden />
          <span>Preview only — no request is sent to a provider and no telemetry is written.</span>
        </div>

        <div className={styles.notice} role="note">
          <Info size={14} aria-hidden />
          <span>Preview currently evaluates autonomous routing only. Client overrides and operator rules are not applied.</span>
        </div>

        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <div className={styles.panel}>
            <div className={styles.panelHead}><span>Request</span></div>
            <div className={styles.panelBody}>
              <label className={styles.field}>
                <span className={styles.label}>Prompt</span>
                <textarea
                  className={styles.textarea}
                  rows={5}
                  value={form.prompt}
                  onChange={(e) => patch({ prompt: e.target.value })}
                  placeholder="Describe the request to route…"
                  aria-invalid={errors.prompt ? true : undefined}
                  aria-describedby={errors.prompt ? "err-prompt" : undefined}
                />
                {errors.prompt ? <span id="err-prompt" className={styles.fieldError}>{errors.prompt}</span> : null}
              </label>

              <details className={styles.collapsible}>
                <summary className={styles.summary}>Requirements (optional)</summary>
                <div className={styles.collapseBody}>
                  <div className={styles.field}>
                    <span className={styles.label}>Required capabilities</span>
                    <div className={styles.checks}>
                      {CAPABILITIES.map((cap) => (
                        <label key={cap} className={styles.check}>
                          <input
                            type="checkbox"
                            checked={form.capabilities.includes(cap)}
                            onChange={() => patch({ capabilities: toggleCapability(form.capabilities, cap) })}
                          />
                          <span>{cap}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className={styles.row}>
                    <label className={styles.field}>
                      <span className={styles.label}>Minimum quality</span>
                      <select
                        className={styles.select}
                        value={form.minQualityTier}
                        onChange={(e) => patch({ minQualityTier: e.target.value as "" | QualityTier })}
                      >
                        <option value="">Any</option>
                        {QUALITY_TIERS.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Max latency (ms)</span>
                      <input
                        className={styles.input}
                        inputMode="numeric"
                        placeholder="Any"
                        value={form.maxLatencyMs}
                        onChange={(e) => patch({ maxLatencyMs: e.target.value })}
                        aria-invalid={errors.maxLatencyMs ? true : undefined}
                      />
                      {errors.maxLatencyMs ? <span className={styles.fieldError}>{errors.maxLatencyMs}</span> : null}
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Max cost (USD)</span>
                      <input
                        className={styles.input}
                        inputMode="decimal"
                        placeholder="Any"
                        value={form.maxCostUsd}
                        onChange={(e) => patch({ maxCostUsd: e.target.value })}
                        aria-invalid={errors.maxCostUsd ? true : undefined}
                      />
                      {errors.maxCostUsd ? <span className={styles.fieldError}>{errors.maxCostUsd}</span> : null}
                    </label>
                  </div>
                </div>
              </details>

              <div className={styles.actions}>
                <button type="submit" className={styles.primaryBtn} disabled={submitting}>
                  <FlaskConical size={14} aria-hidden />
                  {submitting ? "Previewing…" : "Preview routing"}
                </button>
              </div>
            </div>
          </div>
        </form>

        {state.status === "loading" ? (
          <div className={styles.skelStack}>
            {Array.from({ length: 2 }, (_, i) => <div key={i} className={styles.skelBar} style={{ height: 120 }} />)}
          </div>
        ) : state.status === "error" ? (
          <div className={styles.stateError} role="alert">
            <AlertTriangle size={16} aria-hidden />
            <div>
              <div className={styles.stateTitle}>No preview result</div>
              <div className={styles.stateBody}>{state.message}</div>
            </div>
          </div>
        ) : state.status === "ready" ? (
          <PreviewResult decision={state.decision} />
        ) : null}
      </div>
    </AppShell>
  );
}

function PreviewResult({ decision }: { decision: RoutingDecision }) {
  const dec = decisionSourceMeta(decision.decisionSource);
  return (
    <>
      <div className={styles.previewBanner} role="status">
        <FlaskConical size={16} aria-hidden />
        <div>
          <div className={styles.bannerTitle}>Preview</div>
          <div className={styles.bannerBody}>No request was sent to a provider. This is a routing decision only.</div>
        </div>
      </div>

      <div className={styles.grid2}>
        <div className={styles.decisionPanel}>
          <div className={styles.panelHead}><span>Decision</span></div>
          <div className={styles.panelBody}>
            <div className={styles.routeRow}>
              <ProviderLogo providerId={decision.chosenProviderId} modelId={decision.chosenModelId} size={18} variant="bare" />
              <Mono size={13} color="var(--text-primary)">{decision.chosenProviderId}:{decision.chosenModelId}</Mono>
            </div>
            <div className={styles.decisionMeta}>
              <Badge meta={dec} />
              {decision.shadowedSource ? (
                <span className={styles.shadowTag}>shadowed: {decision.shadowedSource.replace(/_/g, " ")}</span>
              ) : null}
            </div>
            <dl className={styles.factList}>
              <Fact label="Selected route" value={`${decision.chosenProviderId}:${decision.chosenModelId}`} mono />
              <Fact label="Estimated cost" value={formatUsd(decision.estimatedCostUsd)} />
              <Fact label="Pricing version" value={decision.pricingTableVersionId} mono />
            </dl>
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHead}><span>Rationale</span></div>
          <RationaleList rationale={decision.rationale} />
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHead}><span>Candidate ranking</span></div>
        <CandidateTable candidates={decision.candidateRanking} />
      </div>
    </>
  );
}

function CandidateTable({ candidates }: { candidates: readonly CandidateScore[] }) {
  if (candidates.length === 0) return <div className={styles.empty}>No candidates returned.</div>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Route</th>
            <th>Included</th>
            <th className={styles.num}>Score</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={`${c.providerId}:${c.modelId}`} className={c.included ? undefined : styles.excludedRow}>
              <td className={styles.mono} title={`${c.providerId}:${c.modelId}`}>{c.providerId}:{c.modelId}</td>
              <td>{c.included ? <span className={styles.inYes}>included</span> : <span className={styles.inNo}>excluded</span>}</td>
              <td className={styles.num}>{fmtScore(c.scoreBreakdown["total"])}</td>
              <td className={styles.reason}>{c.included ? "—" : c.exclusionReason ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RationaleList({ rationale }: { rationale: readonly RationaleEntry[] }) {
  if (rationale.length === 0) return <div className={styles.empty}>No rationale returned.</div>;
  return (
    <ul className={styles.rationaleList}>
      {rationale.map((r, i) => (
        <li key={i} className={styles.rationaleItem}>
          <span className={styles.verdictTag} data-verdict={r.verdict}>{r.verdict}</span>
          <span className={styles.rationaleFactor}>{r.factor}</span>
          {r.note ? <span className={styles.rationaleNote}>{r.note}</span> : null}
        </li>
      ))}
    </ul>
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
