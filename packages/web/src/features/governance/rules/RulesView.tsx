"use client";
import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, ScrollText, ShieldCheck } from "lucide-react";

import { AppShell } from "../../../components/shell/AppShell.js";
import { Chip, Mono, Pill } from "../../../components/primitives/index.js";
import { useHealth } from "../../../hooks/useHealth.js";
import { getEnvironment } from "../../../lib/env.js";
import { formatClockTime, formatRelativeTime, abbreviateId } from "../../../lib/format.js";
import type { OperatorRule } from "../../../types/index.js";
import { GovernanceTabs } from "../GovernanceTabs.js";
import { useRules } from "./useRules.js";
import {
  ANY_LABEL,
  formatEnabled,
  formatMatchConditions,
  formatPin,
  formatPriority,
  isMatchAny,
} from "./rule-presenters.js";
import styles from "./Rules.module.css";

export function RulesView() {
  const env = useMemo(() => getEnvironment(), []);
  const health = useHealth();
  const { status, rules, error, refresh } = useRules();

  const healthy = health.status === "healthy";
  const connection = status === "loading" ? "connecting" : status === "error" ? "error" : "idle";

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
        <header className={styles.head}>
          <div>
            <div className={styles.kicker}>Governance</div>
            <h1 className={styles.title}>Operator Rules</h1>
            <p className={styles.subtitle}>
              Operator rules override client-level overrides and autopilot when matched.
            </p>
          </div>
        </header>

        <div className={styles.note}>
          <ShieldCheck size={13} aria-hidden />
          <span>
            Ordered by priority as evaluated by the backend. Precedence and matching are resolved
            server-side.
          </span>
        </div>

        <div className={styles.panel}>
          {status === "loading" ? (
            <div className={styles.skelStack} aria-busy="true" aria-label="Loading operator rules">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className={styles.skelBar} />
              ))}
            </div>
          ) : status === "error" ? (
            <div className={styles.stateError} role="alert">
              <AlertTriangle size={16} aria-hidden />
              <div>
                <div className={styles.stateTitle}>Couldn’t load operator rules</div>
                <div className={styles.stateBody}>{error}</div>
              </div>
              <button type="button" className={styles.ghostBtn} onClick={refresh}>
                Retry
              </button>
            </div>
          ) : rules.length === 0 ? (
            <div className={styles.empty}>
              <ScrollText size={22} aria-hidden />
              <div className={styles.stateTitle}>No operator rules</div>
              <div className={styles.stateBody}>No operator rules currently exist.</div>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Rule ID</th>
                    <th>Priority</th>
                    <th>State</th>
                    <th>Match</th>
                    <th>Pin</th>
                    <th>Created</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <RuleRow key={rule.ruleId} rule={rule} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function RuleRow({ rule }: { rule: OperatorRule }) {
  const enabled = formatEnabled(rule.enabled);
  const match = formatMatchConditions(rule.match);
  const pin = formatPin(rule.pin);
  const anyMatch = isMatchAny(match);

  return (
    <tr className={rule.enabled ? undefined : styles.rowDisabled}>
      <td title={rule.ruleId}>
        <Link href={`/governance/rules/${rule.ruleId}`} className={styles.ruleLink}>
          <Mono size={12} color="var(--accent-blue)">{abbreviateId(rule.ruleId, 16)}</Mono>
        </Link>
      </td>
      <td className={styles.priority}>
        <Mono size={12} color="var(--text-primary)">{formatPriority(rule.priority)}</Mono>
      </td>
      <td>
        <Pill
          label={enabled.label}
          dot={enabled.tone === "active" ? "var(--success)" : "var(--text-tertiary)"}
          color={enabled.tone === "active" ? "var(--text-primary)" : "var(--text-tertiary)"}
          bg="var(--bg-inset)"
          border="var(--border-default)"
        />
      </td>
      <td>
        {anyMatch ? (
          <Chip color="var(--text-tertiary)" border="var(--border-default)">{ANY_LABEL}</Chip>
        ) : (
          <div className={styles.chipRow}>
            {match.clientIds.map((id) => (
              <Chip key={`c-${id}`} color="var(--accent-blue)" border="var(--accent-blue)">
                {id}
              </Chip>
            ))}
            {match.capabilities.map((cap) => (
              <Chip key={`cap-${cap}`} color="var(--accent-purple)" border="var(--accent-purple)">
                {cap}
              </Chip>
            ))}
            {match.tokens ? (
              <Chip color="var(--text-secondary)" border="var(--border-default)">
                {match.tokens}
              </Chip>
            ) : null}
          </div>
        )}
      </td>
      <td>
        <Mono size={12} color="var(--text-primary)">{pin}</Mono>
      </td>
      <td title={formatClockTime(rule.createdAt)}>{formatRelativeTime(rule.createdAt)}</td>
      <td title={formatClockTime(rule.updatedAt)}>{formatRelativeTime(rule.updatedAt)}</td>
    </tr>
  );
}
