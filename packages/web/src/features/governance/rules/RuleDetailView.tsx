"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ShieldCheck, Trash2 } from "lucide-react";

import { AppShell } from "../../../components/shell/AppShell.js";
import { Chip, Mono, Pill, Toggle } from "../../../components/primitives/index.js";
import { useHealth } from "../../../hooks/useHealth.js";
import { getEnvironment } from "../../../lib/env.js";
import { formatClockTime, formatRelativeTime } from "../../../lib/format.js";
import { ApiCallError } from "../../../lib/api/client.js";
import type { OperatorRule } from "../../../types/index.js";
import { GovernanceTabs } from "../GovernanceTabs.js";
import { useRule } from "./useRule.js";
import {
  ANY_LABEL,
  formatEnabled,
  formatMatchConditions,
  formatPin,
  formatPriority,
  isMatchAny,
} from "./rule-presenters.js";
import styles from "./RuleDetail.module.css";

export function RuleDetailView({ ruleId }: { ruleId: string }) {
  const env = useMemo(() => getEnvironment(), []);
  const health = useHealth();
  const { state, setEnabled, remove } = useRule(ruleId);

  const healthy = health.status === "healthy";
  const connection =
    state.status === "loading" ? "connecting" : state.status === "error" ? "error" : "idle";

  return (
    <AppShell
      connection={connection}
      envLabel={env.envLabel}
      healthy={healthy}
      version={env.appVersion}
      activeKey="Governance"
    >
      <div className={styles.page}>
        <GovernanceTabs />
        <Link href="/governance/rules" className={styles.back}>
          <ArrowLeft size={14} aria-hidden /> Rules
        </Link>

        {state.status === "loading" ? (
          <div className={styles.skelStack} aria-busy="true" aria-label="Loading operator rule">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className={styles.skelBar} />
            ))}
          </div>
        ) : state.status === "error" ? (
          <div className={styles.stateError} role="alert">
            <AlertTriangle size={16} aria-hidden />
            <div>
              <div className={styles.stateTitle}>Couldn’t load this rule</div>
              <div className={styles.stateBody}>{state.message}</div>
            </div>
          </div>
        ) : state.status === "notFound" ? (
          <div className={styles.empty}>
            <div className={styles.stateTitle}>Rule not found</div>
            <div className={styles.stateBody}>
              This operator rule no longer exists.
              <br />
              <span className={styles.monoMuted}>{ruleId}</span>
            </div>
            <Link href="/governance/rules" className={styles.ghostBtn}>
              Back to Rules
            </Link>
          </div>
        ) : (
          <RuleDetailBody rule={state.rule} setEnabled={setEnabled} remove={remove} />
        )}
      </div>
    </AppShell>
  );
}

function RuleDetailBody({
  rule,
  setEnabled,
  remove,
}: {
  rule: OperatorRule;
  setEnabled: (next: boolean) => Promise<OperatorRule>;
  remove: () => Promise<void>;
}) {
  const router = useRouter();
  const enabled = formatEnabled(rule.enabled);
  const match = formatMatchConditions(rule.match);
  const anyMatch = isMatchAny(match);

  const [toggleBusy, setToggleBusy] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function onToggle(next: boolean) {
    if (toggleBusy) return;
    setToggleBusy(true);
    setToggleError(null);
    try {
      await setEnabled(next);
    } catch (err) {
      setToggleError(errorText(err));
    } finally {
      setToggleBusy(false);
    }
  }

  return (
    <>
      <header className={styles.head}>
        <div>
          <div className={styles.kicker}>Governance</div>
          <h1 className={styles.title}>Operator Rule</h1>
          <div className={styles.idRow}>
            <Mono size={13} color="var(--text-secondary)">{rule.ruleId}</Mono>
          </div>
        </div>
        <Pill
          label={enabled.label}
          dot={enabled.tone === "active" ? "var(--success)" : "var(--text-tertiary)"}
          color={enabled.tone === "active" ? "var(--text-primary)" : "var(--text-tertiary)"}
          bg="var(--bg-inset)"
          border="var(--border-default)"
        />
      </header>

      <div className={styles.note}>
        <ShieldCheck size={13} aria-hidden />
        <span>
          Operator rules take precedence over client-level overrides and autopilot when they match.
          Among matching operator rules, lower priority values take precedence; equal priorities are
          resolved deterministically by rule ID.
        </span>
      </div>

      <div className={styles.grid}>
        <Section title="Identity">
          <Field label="Rule ID">
            <Mono size={12} color="var(--text-primary)">{rule.ruleId}</Mono>
          </Field>
          <Field label="Priority">
            <Mono size={12} color="var(--text-primary)">{formatPriority(rule.priority)}</Mono>
          </Field>
          <Field label="Enabled">
            <span className={styles.value}>{enabled.label}</span>
          </Field>
          <Field label="Created">
            <span className={styles.value} title={formatClockTime(rule.createdAt)}>
              {formatRelativeTime(rule.createdAt)}
            </span>
          </Field>
          <Field label="Updated">
            <span className={styles.value} title={formatClockTime(rule.updatedAt)}>
              {formatRelativeTime(rule.updatedAt)}
            </span>
          </Field>
        </Section>

        <Section title="Match conditions">
          <Field label="Client IDs">
            {match.clientIds.length === 0 ? (
              <AnyChip />
            ) : (
              <div className={styles.chipRow}>
                {match.clientIds.map((id) => (
                  <Chip key={id} color="var(--accent-blue)" border="var(--accent-blue)">{id}</Chip>
                ))}
              </div>
            )}
          </Field>
          <Field label="Required capabilities">
            {match.capabilities.length === 0 ? (
              <AnyChip />
            ) : (
              <div className={styles.chipRow}>
                {match.capabilities.map((cap) => (
                  <Chip key={cap} color="var(--accent-purple)" border="var(--accent-purple)">{cap}</Chip>
                ))}
              </div>
            )}
          </Field>
          <Field label="Token bounds">
            {match.tokens ? (
              <Mono size={12} color="var(--text-primary)">{match.tokens}</Mono>
            ) : (
              <AnyChip />
            )}
          </Field>
          {anyMatch ? <div className={styles.hint}>This rule matches any request.</div> : null}
        </Section>

        <Section title="Pin target">
          <Field label="Provider ID">
            {rule.pin.providerId === null ? (
              <span className={styles.none}>None</span>
            ) : (
              <Mono size={12} color="var(--text-primary)">{rule.pin.providerId}</Mono>
            )}
          </Field>
          <Field label="Model ID">
            {rule.pin.modelId === null ? (
              <span className={styles.none}>None</span>
            ) : (
              <Mono size={12} color="var(--text-primary)">{rule.pin.modelId}</Mono>
            )}
          </Field>
          <Field label="Resolved pin">
            <Mono size={12} color="var(--text-primary)">{formatPin(rule.pin)}</Mono>
          </Field>
        </Section>

        <Section title="Lifecycle">
          <div className={styles.lifecycleRow}>
            <div>
              <div className={styles.lifecycleLabel}>{rule.enabled ? "Enabled" : "Disabled"}</div>
              <div className={styles.hint}>
                {rule.enabled
                  ? "This rule is active and eligible to match."
                  : "This rule is inactive and will not match."}
              </div>
            </div>
            <Toggle
              on={rule.enabled}
              onChange={onToggle}
              ariaLabel={rule.enabled ? "Disable rule" : "Enable rule"}
              {...(toggleBusy ? { style: { opacity: 0.5, pointerEvents: "none" as const } } : {})}
            />
          </div>
          {toggleError ? (
            <div className={styles.formError} role="alert">
              <AlertTriangle size={13} aria-hidden /> {toggleError}
            </div>
          ) : null}

          <div className={styles.divider} />

          <div className={styles.lifecycleRow}>
            <div>
              <div className={styles.lifecycleLabel}>Delete</div>
              <div className={styles.hint}>Permanently removes this operator rule.</div>
            </div>
            <button type="button" className={styles.dangerBtn} onClick={() => setDeleteOpen(true)}>
              <Trash2 size={13} aria-hidden /> Delete rule
            </button>
          </div>
        </Section>
      </div>

      {deleteOpen ? (
        <Modal titleId="delete-rule-title" onClose={deleteBusy ? undefined : () => setDeleteOpen(false)}>
          <div className={styles.modalHead}>
            <h2 id="delete-rule-title" className={styles.modalTitle}>Delete operator rule</h2>
          </div>
          <p className={styles.modalBody}>
            This permanently removes operator rule{" "}
            <span className={styles.monoMuted}>{rule.ruleId}</span>. This action cannot be undone.
          </p>
          {deleteError ? (
            <div className={styles.formError} role="alert">
              <AlertTriangle size={13} aria-hidden /> {deleteError}
            </div>
          ) : null}
          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.ghostBtn}
              disabled={deleteBusy}
              onClick={() => setDeleteOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.dangerBtn}
              disabled={deleteBusy}
              onClick={async () => {
                setDeleteBusy(true);
                setDeleteError(null);
                try {
                  await remove();
                  router.push("/governance/rules");
                  router.refresh();
                } catch (err) {
                  setDeleteError(errorText(err));
                  setDeleteBusy(false);
                }
              }}
            >
              {deleteBusy ? "Deleting…" : "Delete rule"}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <div className={styles.fieldLabel}>{label}</div>
      <div className={styles.fieldValue}>{children}</div>
    </div>
  );
}

function AnyChip() {
  return <Chip color="var(--text-tertiary)" border="var(--border-default)">{ANY_LABEL}</Chip>;
}

function Modal({
  titleId,
  onClose,
  children,
}: {
  titleId: string;
  onClose?: (() => void) | undefined;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className={styles.overlay}
      onMouseDown={onClose ? (e) => e.target === e.currentTarget && onClose() : undefined}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {children}
      </div>
    </div>
  );
}

function errorText(err: unknown): string {
  if (err instanceof ApiCallError) {
    if (err.status === 404) return "This rule no longer exists. It may have been deleted.";
    if (err.status === 400) return "Invalid request — the change was rejected.";
    if (err.status === 401) return "Not authorized — check your API key.";
    return err.message;
  }
  return err instanceof Error ? err.message : "Request failed";
}
