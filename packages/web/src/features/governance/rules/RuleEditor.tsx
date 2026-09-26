"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, Plus, X } from "lucide-react";

import { Mono, Toggle } from "../../../components/primitives/index.js";
import { getEnvironment } from "../../../lib/env.js";
import { ApiCallError } from "../../../lib/api/client.js";
import { createRule, updateRule } from "../../../lib/api/rules.js";
import type { OperatorRule } from "../../../types/index.js";
import {
  CAPABILITIES,
  buildPayload,
  emptyForm,
  formFromRule,
  hasErrors,
  toggleCapability,
  validateForm,
  type RuleFormErrors,
  type RuleFormState,
} from "./rule-form.js";
import styles from "./RuleEditor.module.css";

export function RuleEditor({
  mode,
  initialRule,
  onCancel,
  onSaved,
}: {
  mode: "create" | "edit";
  initialRule?: OperatorRule;
  onCancel: () => void;
  onSaved: (rule: OperatorRule) => void;
}) {
  const env = useMemo(() => getEnvironment(), []);
  const [state, setState] = useState<RuleFormState>(() =>
    mode === "edit" && initialRule ? formFromRule(initialRule) : emptyForm(),
  );
  const [errors, setErrors] = useState<RuleFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function patch(next: Partial<RuleFormState>) {
    setState((s) => ({ ...s, ...next }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const found = validateForm(state);
    setErrors(found);
    if (hasErrors(found)) return;

    setSubmitting(true);
    setFormError(null);
    try {
      const payload = buildPayload(state);
      const saved =
        mode === "create"
          ? await createRule(payload, env.apiKey ? { apiKey: env.apiKey } : {})
          : await updateRule(initialRule!.ruleId, payload, env.apiKey ? { apiKey: env.apiKey } : {});
      onSaved(saved);
    } catch (err) {
      setFormError(errorText(err));
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      {mode === "edit" && initialRule ? (
        <div className={styles.identity}>
          <span className={styles.identityLabel}>Editing</span>
          <Mono size={12} color="var(--text-secondary)">{initialRule.ruleId}</Mono>
        </div>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Rule configuration</h2>
        <div className={styles.sectionBody}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="rule-priority">Priority</label>
            <div className={styles.control}>
              <input
                id="rule-priority"
                className={styles.input}
                inputMode="numeric"
                value={state.priority}
                onChange={(e) => patch({ priority: e.target.value })}
                aria-invalid={errors.priority ? true : undefined}
                aria-describedby={errors.priority ? "err-priority" : undefined}
              />
              <div className={styles.hint}>Any integer. Lower values win at runtime (resolved server-side).</div>
              {errors.priority ? (
                <div id="err-priority" className={styles.fieldError}>{errors.priority}</div>
              ) : null}
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Enabled</span>
            <div className={styles.control}>
              <div className={styles.toggleRow}>
                <Toggle
                  on={state.enabled}
                  onChange={(next) => patch({ enabled: next })}
                  ariaLabel={state.enabled ? "Disable rule" : "Enable rule"}
                />
                <span className={styles.toggleText}>{state.enabled ? "Enabled" : "Disabled"}</span>
              </div>
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Client IDs</span>
            <div className={styles.control}>
              {state.clientIds.length === 0 ? (
                <div className={styles.hint}>No client IDs — matches any client (Any).</div>
              ) : (
                <div className={styles.stack}>
                  {state.clientIds.map((id, i) => (
                    <div key={i} className={styles.rowInput}>
                      <input
                        className={styles.input}
                        value={id}
                        aria-label={`Client ID ${i + 1}`}
                        placeholder="acme-prod"
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => {
                          const nextIds = [...state.clientIds];
                          nextIds[i] = e.target.value;
                          patch({ clientIds: nextIds });
                        }}
                      />
                      <button
                        type="button"
                        className={styles.iconBtn}
                        aria-label={`Remove client ID ${i + 1}`}
                        onClick={() => patch({ clientIds: state.clientIds.filter((_, j) => j !== i) })}
                      >
                        <X size={14} aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                className={styles.addBtn}
                onClick={() => patch({ clientIds: [...state.clientIds, ""] })}
              >
                <Plus size={13} aria-hidden /> Add client ID
              </button>
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Required capabilities</span>
            <div className={styles.control}>
              <div className={styles.checks}>
                {CAPABILITIES.map((cap) => (
                  <label key={cap} className={styles.check}>
                    <input
                      type="checkbox"
                      checked={state.capabilities.includes(cap)}
                      onChange={() => patch({ capabilities: toggleCapability(state.capabilities, cap) })}
                    />
                    <span>{cap}</span>
                  </label>
                ))}
              </div>
              {state.capabilities.length === 0 ? (
                <div className={styles.hint}>None selected — matches any capabilities (Any).</div>
              ) : null}
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Token bounds</span>
            <div className={styles.control}>
              <div className={styles.tokenRow}>
                <div className={styles.tokenCol}>
                  <label className={styles.subLabel} htmlFor="rule-min">Minimum</label>
                  <input
                    id="rule-min"
                    className={styles.input}
                    inputMode="numeric"
                    placeholder="Any"
                    value={state.minTokens}
                    onChange={(e) => patch({ minTokens: e.target.value })}
                    aria-invalid={errors.minTokens ? true : undefined}
                  />
                  {errors.minTokens ? <div className={styles.fieldError}>{errors.minTokens}</div> : null}
                </div>
                <div className={styles.tokenCol}>
                  <label className={styles.subLabel} htmlFor="rule-max">Maximum</label>
                  <input
                    id="rule-max"
                    className={styles.input}
                    inputMode="numeric"
                    placeholder="Any"
                    value={state.maxTokens}
                    onChange={(e) => patch({ maxTokens: e.target.value })}
                    aria-invalid={errors.maxTokens ? true : undefined}
                  />
                  {errors.maxTokens ? <div className={styles.fieldError}>{errors.maxTokens}</div> : null}
                </div>
              </div>
              {errors.tokenRange ? <div className={styles.fieldError}>{errors.tokenRange}</div> : null}
              <div className={styles.hint}>Leave blank for no bound.</div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Routing pin</h2>
        <div className={styles.sectionBody}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="rule-provider">Provider ID</label>
            <div className={styles.control}>
              <input
                id="rule-provider"
                className={styles.input}
                placeholder="e.g. openai"
                autoComplete="off"
                spellCheck={false}
                value={state.providerId}
                onChange={(e) => patch({ providerId: e.target.value })}
                aria-invalid={errors.pin ? true : undefined}
              />
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="rule-model">Model ID</label>
            <div className={styles.control}>
              <input
                id="rule-model"
                className={styles.input}
                placeholder="e.g. gpt-4o"
                autoComplete="off"
                spellCheck={false}
                value={state.modelId}
                onChange={(e) => patch({ modelId: e.target.value })}
                aria-invalid={errors.pin ? true : undefined}
              />
              <div className={styles.hint}>Provide a provider ID, a model ID, or both.</div>
              {errors.pin ? <div className={styles.fieldError}>{errors.pin}</div> : null}
            </div>
          </div>
        </div>
      </section>

      {formError ? (
        <div className={styles.formError} role="alert">
          <AlertTriangle size={14} aria-hidden /> {formError}
        </div>
      ) : null}

      <div className={styles.actions}>
        <button type="button" className={styles.ghostBtn} onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className={styles.primaryBtn} disabled={submitting}>
          {submitting ? "Saving…" : mode === "create" ? "Create rule" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function errorText(err: unknown): string {
  if (err instanceof ApiCallError) {
    if (err.status === 400) return "The server rejected these values. Review the fields and try again.";
    if (err.status === 404) return "This rule no longer exists. It may have been deleted.";
    if (err.status === 401) return "Not authorized — check your API key.";
    return err.message;
  }
  return err instanceof Error ? err.message : "Request failed";
}
