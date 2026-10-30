"use client";

import { useMemo } from "react";

import { AppShell } from "@/components/shell/AppShell";
import { Mono, Pill, ProviderLogo, resolveProviderFamilyColor } from "@/components/primitives";
import { formatInt, formatMs, formatUsd } from "@/lib/format";

import { CAPABILITIES } from "./playground-form";
import { computeSavings } from "./savings-model";
import { usePlayground, type PlaygroundRunResult } from "./usePlayground";
import styles from "./Playground.module.css";

const QUALITY_OPTIONS: { value: "" | "low" | "standard" | "high"; label: string }[] = [
  { value: "", label: "Any quality" },
  { value: "low", label: "Low" },
  { value: "standard", label: "Standard" },
  { value: "high", label: "High" },
];

export function PlaygroundView() {
  const {
    env,
    form,
    errors,
    apiKey,
    setApiKey,
    run,
    patch,
    toggleCap,
    submit,
    providerOptions,
    modelOptions,
  } = usePlayground();

  const running = run.status === "running";

  return (
    <AppShell
      connection={running ? "connecting" : "idle"}
      envLabel={env.envLabel}
      healthy={run.status !== "error"}
      version={env.appVersion}
      activeKey="Playground"
    >
      <div className={styles.page}>
        <header className={styles.head}>
          <div className={styles.kicker}>Try LCA</div>
          <h1 className={styles.title}>Playground</h1>
          <p className={styles.subtitle}>
            Send a real request through the routing engine and see which model it picks, what it
            costs, and how much you save versus the most expensive viable model.
          </p>
        </header>

        <div className={styles.layout}>
          {/* ── Request form ─────────────────────────────── */}
          <form
            className={styles.panel}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            noValidate
          >
            <h2 className={styles.panelTitle}>Request</h2>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="pg-system">
                System prompt <span className={styles.optional}>optional</span>
              </label>
              <textarea
                id="pg-system"
                className={styles.textarea}
                rows={2}
                value={form.systemPrompt}
                onChange={(e) => patch({ systemPrompt: e.target.value })}
                placeholder="You are a helpful assistant."
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="pg-prompt">
                Prompt
              </label>
              <textarea
                id="pg-prompt"
                className={styles.textarea}
                rows={5}
                value={form.prompt}
                onChange={(e) => patch({ prompt: e.target.value })}
                placeholder="Summarize the benefits of cost-aware LLM routing."
                aria-invalid={errors.prompt ? true : undefined}
                aria-describedby={errors.prompt ? "pg-prompt-err" : undefined}
              />
              {errors.prompt && (
                <div id="pg-prompt-err" className={styles.fieldError}>
                  {errors.prompt}
                </div>
              )}
            </div>

            <div className={styles.grid2}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="pg-quality">
                  Min quality
                </label>
                <select
                  id="pg-quality"
                  className={styles.select}
                  value={form.minQualityTier}
                  onChange={(e) =>
                    patch({ minQualityTier: e.target.value as typeof form.minQualityTier })
                  }
                >
                  {QUALITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="pg-latency">
                  Max latency (ms)
                </label>
                <input
                  id="pg-latency"
                  className={styles.input}
                  inputMode="numeric"
                  value={form.maxLatencyMs}
                  onChange={(e) => patch({ maxLatencyMs: e.target.value })}
                  placeholder="e.g. 2000"
                  aria-invalid={errors.maxLatencyMs ? true : undefined}
                />
                {errors.maxLatencyMs && <div className={styles.fieldError}>{errors.maxLatencyMs}</div>}
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="pg-cost">
                Max cost (USD) <span className={styles.optional}>optional</span>
              </label>
              <input
                id="pg-cost"
                className={styles.input}
                inputMode="decimal"
                value={form.maxCostUsd}
                onChange={(e) => patch({ maxCostUsd: e.target.value })}
                placeholder="e.g. 0.01"
                aria-invalid={errors.maxCostUsd ? true : undefined}
              />
              {errors.maxCostUsd && <div className={styles.fieldError}>{errors.maxCostUsd}</div>}
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Required capabilities</span>
              <div className={styles.checks}>
                {CAPABILITIES.map((cap) => (
                  <label key={cap} className={styles.check}>
                    <input
                      type="checkbox"
                      checked={form.capabilities.includes(cap)}
                      onChange={() => toggleCap(cap)}
                    />
                    <span>{cap}</span>
                  </label>
                ))}
              </div>
            </div>

            <details className={styles.advanced}>
              <summary className={styles.summary}>Advanced: pin a provider or model</summary>
              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="pg-provider">
                    Provider
                  </label>
                  <select
                    id="pg-provider"
                    className={styles.select}
                    value={form.overrideProviderId}
                    onChange={(e) =>
                      patch({ overrideProviderId: e.target.value, overrideModelId: "" })
                    }
                  >
                    <option value="">Autopilot chooses</option>
                    {providerOptions.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="pg-model">
                    Model
                  </label>
                  <select
                    id="pg-model"
                    className={styles.select}
                    value={form.overrideModelId}
                    onChange={(e) => patch({ overrideModelId: e.target.value })}
                  >
                    <option value="">Autopilot chooses</option>
                    {modelOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </details>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="pg-key">
                API key <span className={styles.optional}>Bearer token</span>
              </label>
              <input
                id="pg-key"
                className={styles.input}
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="lca_…"
                autoComplete="off"
              />
            </div>

            <button className={styles.submit} type="submit" disabled={running}>
              {running ? "Routing…" : "Send request"}
            </button>
          </form>

          {/* ── Result ───────────────────────────────────── */}
          <div className={styles.panel}>
            <h2 className={styles.panelTitle}>Result</h2>
            {run.status === "idle" && (
              <p className={styles.placeholder}>
                Send a request to see the routing decision, token usage, cost, and savings.
              </p>
            )}
            {run.status === "running" && <p className={styles.placeholder}>Routing your request…</p>}
            {run.status === "error" && (
              <div className={styles.errorBox}>
                <div className={styles.errorTitle}>Request failed</div>
                <div className={styles.errorMsg}>{run.message}</div>
                {run.requestId && (
                  <div className={styles.errorMeta}>
                    <Mono>request-id {run.requestId}</Mono>
                  </div>
                )}
              </div>
            )}
            {run.status === "success" && (
              <ResultPanel result={run.result} />
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function ResultPanel({ result }: { result: PlaygroundRunResult }) {
  const { response, roundTripMs } = result;
  const { decision, usage } = response;
  const savings = useMemo(() => computeSavings(decision), [decision]);
  const accent = resolveProviderFamilyColor(response.providerId, response.modelId);

  const sourceLabel: Record<string, string> = {
    autopilot: "Autopilot",
    client_override: "Client override",
    operator_rule: "Operator rule",
  };

  return (
    <div className={styles.result}>
      {/* Chosen route */}
      <div className={styles.route}>
        <ProviderLogo providerId={response.providerId} modelId={response.modelId} size={22} />
        <div className={styles.routeText}>
          <div className={styles.routeModel}>{response.modelId}</div>
          <div className={styles.routeProvider}>{response.providerId}</div>
        </div>
        <Pill
          label={sourceLabel[decision.decisionSource] ?? decision.decisionSource}
          color={accent}
          border={`${accent}55`}
          dot={accent}
        />
      </div>

      {/* Key metrics */}
      <div className={styles.metrics}>
        <Metric label="Input tokens" value={formatInt(usage.inputTokens)} />
        <Metric label="Output tokens" value={formatInt(usage.outputTokens)} />
        <Metric label="Est. cost" value={formatUsd(decision.estimatedCostUsd)} />
        <Metric label="Round-trip" value={formatMs(roundTripMs)} />
        <Metric label="Finish" value={response.finishReason} />
      </div>

      {/* Savings */}
      {savings.comparable ? (
        <div className={styles.savings}>
          <div className={styles.savingsTitle}>Cost savings</div>
          <div className={styles.savingsRows}>
            <div className={styles.savingsRow}>
              <span>Without LCA</span>
              <span className={styles.savingsStrike}>{formatUsd(savings.baselineCostUsd)}</span>
            </div>
            <div className={styles.savingsRow}>
              <span>With LCA</span>
              <span className={styles.savingsWith}>{formatUsd(savings.chosenCostUsd)}</span>
            </div>
            <div className={styles.savingsTotal}>
              <span>You saved</span>
              <span>
                {formatUsd(savings.savingsUsd)}{" "}
                <span className={styles.savingsPct}>({savings.savingsPct.toFixed(1)}%)</span>
              </span>
            </div>
          </div>
          {savings.baselineModelId && (
            <div className={styles.savingsNote}>
              Baseline is the most expensive viable model for this request (
              <Mono>{savings.baselineModelId}</Mono>).
            </div>
          )}
        </div>
      ) : (
        <div className={styles.savingsNote}>
          Only one viable model for this request — no cheaper alternative to compare against.
        </div>
      )}

      {/* Response content */}
      <div className={styles.field}>
        <span className={styles.label}>Response</span>
        <pre className={styles.response}>{response.content || "(empty response)"}</pre>
      </div>

      {/* Candidate ranking */}
      <div className={styles.field}>
        <span className={styles.label}>Candidates considered</span>
        <div className={styles.candidates}>
          {decision.candidateRanking.map((c) => {
            const chosen = c.providerId === response.providerId && c.modelId === response.modelId;
            return (
              <div
                key={`${c.providerId}:${c.modelId}`}
                className={chosen ? `${styles.candidate} ${styles.candidateChosen}` : styles.candidate}
              >
                <span className={styles.candidateName}>
                  <Mono size={10} color="var(--text-primary)">
                    {c.modelId}
                  </Mono>
                </span>
                <span className={styles.candidateCost}>
                  {c.estimatedCostUsd != null ? formatUsd(c.estimatedCostUsd) : "—"}
                </span>
                <span className={styles.candidateStatus}>
                  {chosen ? "chosen" : c.included ? "viable" : "excluded"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Rationale */}
      {decision.rationale.length > 0 && (
        <details className={styles.advanced}>
          <summary className={styles.summary}>Why this route?</summary>
          <ul className={styles.rationale}>
            {decision.rationale.map((r, i) => (
              <li key={i} className={styles.rationaleItem}>
                <span className={styles.rationaleFactor}>{r.factor}</span>
                <span>{r.note}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={styles.metricValue}>{value}</div>
    </div>
  );
}
