"use client";
import { useState } from "react";
import { FlaskConical, AlertTriangle, ArrowRight, ShieldCheck } from "lucide-react";

import { decisionSourceMeta } from "../routing-explorer/event-presenters.js";
import { CAPABILITIES } from "./preview-form.js";
import { useSimulation } from "./useSimulation.js";
import {
  buildSimulateBody,
  emptySimulationForm,
  hasSimulationErrors,
  toggleFormCapability,
  validateSimulationForm,
  type SimulationFormErrors,
  type SimulationFormState,
} from "./simulation-form.js";
import { presentSimulation, type SimulationSideView, type SimulationView } from "./simulation-model.js";
import styles from "./Preview.module.css";

export function SimulationSection() {
  const { state, run } = useSimulation();
  const [form, setForm] = useState<SimulationFormState>(() => emptySimulationForm());
  const [errors, setErrors] = useState<SimulationFormErrors>({});

  const submitting = state.status === "loading";
  const view = state.status === "ready" ? presentSimulation(state.data) : null;

  function patch(next: Partial<SimulationFormState>) {
    setForm((f) => ({ ...f, ...next }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const found = validateSimulationForm(form);
    setErrors(found);
    if (hasSimulationErrors(found)) return;
    run(buildSimulateBody(form));
  }

  return (
    <section className={styles.simSection} aria-labelledby="sim-heading">
      <header className={styles.simHead}>
        <h2 id="sim-heading" className={styles.simTitle}>
          <ShieldCheck size={16} aria-hidden /> Governance Dry-Run
        </h2>
        <p className={styles.simSubtitle}>
          See how a proposed operator rule would change routing for a request. The rule is not saved, no provider is
          called, and no budget is spent — use the Rules page to persist a rule.
        </p>
      </header>

      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.panel}>
          <div className={styles.panelHead}><span>Request + proposed rule</span></div>
          <div className={styles.panelBody}>
            <label className={styles.field}>
              <span className={styles.label}>Prompt</span>
              <textarea
                className={styles.textarea}
                value={form.prompt}
                onChange={(e) => patch({ prompt: e.target.value })}
                placeholder="A representative request prompt…"
                aria-invalid={errors.prompt ? true : undefined}
              />
              {errors.prompt ? <span className={styles.fieldError}>{errors.prompt}</span> : null}
            </label>

            <div className={styles.row}>
              <label className={styles.field}>
                <span className={styles.label}>Priority</span>
                <input
                  className={styles.input}
                  value={form.priority}
                  onChange={(e) => patch({ priority: e.target.value })}
                  inputMode="numeric"
                  aria-invalid={errors.priority ? true : undefined}
                />
                {errors.priority ? <span className={styles.fieldError}>{errors.priority}</span> : null}
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Pin provider</span>
                <input className={styles.input} value={form.pinProviderId} onChange={(e) => patch({ pinProviderId: e.target.value })} placeholder="e.g. mock-fast" />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Pin model (optional)</span>
                <input className={styles.input} value={form.pinModelId} onChange={(e) => patch({ pinModelId: e.target.value })} placeholder="e.g. mock-fast:default" />
              </label>
            </div>
            {errors.pin ? <span className={styles.fieldError}>{errors.pin}</span> : null}

            <label className={styles.check}>
              <input type="checkbox" checked={form.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
              Rule enabled
            </label>

            <details className={styles.collapsible}>
              <summary className={styles.summary}>Match conditions (optional)</summary>
              <div className={styles.collapseBody}>
                <label className={styles.field}>
                  <span className={styles.label}>Client IDs (comma-separated)</span>
                  <input className={styles.input} value={form.matchClientIds} onChange={(e) => patch({ matchClientIds: e.target.value })} placeholder="leave blank to match any client" />
                </label>
                <div className={styles.field}>
                  <span className={styles.label}>Required capabilities</span>
                  <div className={styles.checks}>
                    {CAPABILITIES.map((cap) => (
                      <label key={cap} className={styles.check}>
                        <input
                          type="checkbox"
                          checked={form.matchCapabilities.includes(cap)}
                          onChange={() => patch({ matchCapabilities: toggleFormCapability(form.matchCapabilities, cap) })}
                        />
                        {cap}
                      </label>
                    ))}
                  </div>
                </div>
                <div className={styles.row}>
                  <label className={styles.field}>
                    <span className={styles.label}>Min tokens</span>
                    <input className={styles.input} value={form.minTokens} onChange={(e) => patch({ minTokens: e.target.value })} inputMode="numeric" aria-invalid={errors.minTokens ? true : undefined} />
                    {errors.minTokens ? <span className={styles.fieldError}>{errors.minTokens}</span> : null}
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Max tokens</span>
                    <input className={styles.input} value={form.maxTokens} onChange={(e) => patch({ maxTokens: e.target.value })} inputMode="numeric" aria-invalid={errors.maxTokens ? true : undefined} />
                    {errors.maxTokens ? <span className={styles.fieldError}>{errors.maxTokens}</span> : null}
                  </label>
                </div>
              </div>
            </details>

            <div className={styles.actions}>
              <button type="submit" className={styles.primaryBtn} disabled={submitting}>
                <FlaskConical size={14} aria-hidden />
                {submitting ? "Simulating…" : "Run simulation"}
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
            <div className={styles.stateTitle}>Simulation failed</div>
            <div className={styles.stateBody}>{state.message}</div>
          </div>
        </div>
      ) : view ? (
        <SimulationResult view={view} />
      ) : null}
    </section>
  );
}

function SimulationResult({ view }: { view: SimulationView }) {
  return (
    <>
      <div className={styles.previewBanner} role="status">
        <FlaskConical size={16} aria-hidden />
        <div>
          <div className={styles.bannerTitle}>{view.proposalSummary}</div>
          <div className={styles.bannerBody}>No provider was called, no rule was saved, and no budget was changed.</div>
        </div>
      </div>

      <div className={styles.grid2}>
        <SideCard title="Current (live)" side={view.current} />
        <SideCard
          title="Proposed"
          side={view.proposed}
          providerChanged={view.providerChanged}
          modelChanged={view.modelChanged}
          budgetChanged={view.budgetOutcomeChanged}
        />
      </div>

      <div className={styles.simCompare} role="group" aria-label="Simulation comparison">
        <CompareItem label="Decision" changed={view.decisionChanged} />
        <div className={styles.compareItem}>
          <span className={styles.factLabel}>Cost delta</span>
          <span
            className={
              view.costDeltaSign === "up" ? styles.deltaUp : view.costDeltaSign === "down" ? styles.deltaDown : styles.factValueMono
            }
          >
            {view.costDeltaDisplay}
          </span>
        </div>
        <CompareItem label="Budget outcome" changed={view.budgetOutcomeChanged} />
      </div>
    </>
  );
}

function SideCard({
  title,
  side,
  providerChanged,
  modelChanged,
  budgetChanged,
}: {
  title: string;
  side: SimulationSideView;
  providerChanged?: boolean;
  modelChanged?: boolean;
  budgetChanged?: boolean;
}) {
  const src = decisionSourceMeta(side.source);
  const toneClass =
    side.budgetTone === "success" ? styles.bTagSuccess
      : side.budgetTone === "warn" ? styles.bTagWarn
        : side.budgetTone === "error" ? styles.bTagError
          : styles.bTagNeutral;
  return (
    <div className={styles.decisionPanel}>
      <div className={styles.panelHead}><span>{title}</span></div>
      <div className={styles.panelBody}>
        <dl className={styles.factList}>
          <Fact label="Governance" value={src.label} />
          <Fact label="Provider" value={side.provider} changed={Boolean(providerChanged)} />
          <Fact label="Model" value={side.model} changed={Boolean(modelChanged)} />
          <Fact label="Estimated cost" value={side.estimatedDisplay} mono />
          <div className={styles.fact}>
            <dt className={styles.factLabel}>Budget {budgetChanged ? <ChangedTag /> : null}</dt>
            <dd><span className={`${styles.bTag} ${toneClass}`}>{side.budgetLabel}</span></dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function Fact({ label, value, mono, changed }: { label: string; value: string; mono?: boolean; changed?: boolean }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label} {changed ? <ChangedTag /> : null}</dt>
      <dd className={mono ? styles.factValueMono : styles.factValue}>{value}</dd>
    </div>
  );
}

function CompareItem({ label, changed }: { label: string; changed: boolean }) {
  return (
    <div className={styles.compareItem}>
      <span className={styles.factLabel}>{label}</span>
      <span className={changed ? styles.changedPill : styles.unchangedPill}>
        {changed ? (<><ArrowRight size={11} aria-hidden /> Changed</>) : "Unchanged"}
      </span>
    </div>
  );
}

function ChangedTag() {
  return (
    <span className={styles.changedTag}>
      <ArrowRight size={10} aria-hidden /> changed
    </span>
  );
}
