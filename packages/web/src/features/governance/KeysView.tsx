"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Copy, Check, KeyRound, Plus, X } from "lucide-react";

import { AppShell } from "../../components/shell/AppShell.js";
import { useHealth } from "../../hooks/useHealth.js";
import { getEnvironment } from "../../lib/env.js";
import { formatClockTime, formatRelativeTime, abbreviateId } from "../../lib/format.js";
import { ApiCallError } from "../../lib/api/client.js";
import type { ApiKeyMetadata } from "../../types/index.js";
import type { CreatedKey } from "../../lib/api/keys.js";
import { useKeys } from "./useKeys.js";
import { keyStatus } from "./keys-presenters.js";
import styles from "./Keys.module.css";

export function KeysView() {
  const env = useMemo(() => getEnvironment(), []);
  const health = useHealth();
  const { status, keys, error, refresh, createKey, revokeKey } = useKeys();

  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<CreatedKey | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyMetadata | null>(null);

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
        <header className={styles.head}>
          <div>
            <div className={styles.kicker}>Governance</div>
            <h1 className={styles.title}>API Keys</h1>
            <p className={styles.subtitle}>
              Bearer credentials for clients. Secrets are shown once on creation and never again.
            </p>
          </div>
          <button type="button" className={styles.primaryBtn} onClick={() => setCreateOpen(true)}>
            <Plus size={14} aria-hidden /> New key
          </button>
        </header>

        <div className={styles.panel}>
          {status === "loading" ? (
            <div className={styles.skelStack} aria-busy="true" aria-label="Loading API keys">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className={styles.skelBar} style={{ height: 44 }} />
              ))}
            </div>
          ) : status === "error" ? (
            <div className={styles.stateError} role="alert">
              <AlertTriangle size={16} aria-hidden />
              <div>
                <div className={styles.stateTitle}>Couldn’t load API keys</div>
                <div className={styles.stateBody}>{error}</div>
              </div>
              <button type="button" className={styles.ghostBtn} onClick={refresh}>
                Retry
              </button>
            </div>
          ) : keys.length === 0 ? (
            <div className={styles.empty}>
              <KeyRound size={22} aria-hidden />
              <div className={styles.stateTitle}>No API keys yet</div>
              <div className={styles.stateBody}>Create a key to authenticate a client.</div>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Client</th>
                    <th>Key ID</th>
                    <th>Created</th>
                    <th>Last used</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => {
                    const st = keyStatus(k);
                    return (
                      <tr key={k.keyId} className={st === "revoked" ? styles.rowRevoked : undefined}>
                        <td className={styles.cellLabel}>{k.label}</td>
                        <td className={styles.mono}>{k.clientId}</td>
                        <td className={styles.mono} title={k.keyId}>{abbreviateId(k.keyId, 16)}</td>
                        <td title={formatClockTime(k.createdAt)}>{formatRelativeTime(k.createdAt)}</td>
                        <td title={k.lastUsedAt ? formatClockTime(k.lastUsedAt) : undefined}>
                          {k.lastUsedAt ? formatRelativeTime(k.lastUsedAt) : <span className={styles.muted}>never</span>}
                        </td>
                        <td>
                          {st === "active" ? (
                            <span className={styles.badgeActive}>
                              <span className={styles.dotOk} aria-hidden /> active
                            </span>
                          ) : (
                            <span className={styles.badgeRevoked} title={k.revokedAt ? `revoked ${formatRelativeTime(k.revokedAt)}` : undefined}>
                              revoked{k.revokedAt ? ` · ${formatRelativeTime(k.revokedAt)}` : ""}
                            </span>
                          )}
                        </td>
                        <td className={styles.cellAction}>
                          {st === "active" ? (
                            <button type="button" className={styles.revokeBtn} onClick={() => setRevokeTarget(k)}>
                              Revoke
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {createOpen ? (
        secret ? (
          <SecretPanel
            secret={secret}
            onClose={() => {
              // Drop the plaintext secret from memory and refresh the list.
              setSecret(null);
              setCreateOpen(false);
              refresh();
            }}
          />
        ) : (
          <CreateKeyModal
            onCancel={() => setCreateOpen(false)}
            onCreate={async (input) => {
              const created = await createKey(input);
              setSecret(created);
            }}
          />
        )
      ) : null}

      {revokeTarget ? (
        <RevokeModal
          target={revokeTarget}
          onCancel={() => setRevokeTarget(null)}
          onConfirm={async () => {
            await revokeKey(revokeTarget.keyId);
            setRevokeTarget(null);
            refresh();
          }}
        />
      ) : null}
    </AppShell>
  );
}

function CreateKeyModal({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (input: { clientId: string; label: string }) => Promise<void>;
}) {
  const [clientId, setClientId] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => firstRef.current?.focus(), []);

  const valid = clientId.trim().length > 0 && label.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ clientId: clientId.trim(), label: label.trim() });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal titleId="create-key-title" onClose={onCancel}>
      <form onSubmit={submit}>
        <div className={styles.modalHead}>
          <h2 id="create-key-title" className={styles.modalTitle}>New API key</h2>
          <button type="button" className={styles.iconBtn} aria-label="Close" onClick={onCancel}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Client ID</span>
          <input
            ref={firstRef}
            className={styles.input}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="acme-prod"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Label</span>
          <input
            className={styles.input}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="production key"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {error ? (
          <div className={styles.formError} role="alert">
            <AlertTriangle size={13} aria-hidden /> {error}
          </div>
        ) : null}
        <div className={styles.modalActions}>
          <button type="button" className={styles.ghostBtn} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryBtn} disabled={!valid || busy}>
            {busy ? "Creating…" : "Create key"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SecretPanel({ secret, onClose }: { secret: CreatedKey; onClose: () => void }) {
  const [ack, setAck] = useState(false);
  const authHeader = `Authorization: Bearer ${secret.secret}`;
  return (
    <Modal titleId="secret-title" onClose={undefined}>
      <div className={styles.modalHead}>
        <h2 id="secret-title" className={styles.modalTitle}>Copy your secret now</h2>
      </div>
      <div className={styles.secretWarn} role="alert">
        <AlertTriangle size={14} aria-hidden /> This secret is shown once and cannot be retrieved again.
      </div>
      <div className={styles.secretMeta}>
        <span className={styles.mono}>{secret.clientId}</span>
        <span className={styles.muted}>·</span>
        <span>{secret.label}</span>
      </div>
      <div className={styles.secretBox}>
        <code className={styles.secretValue}>{secret.secret}</code>
      </div>
      <div className={styles.copyRow}>
        <CopyButton text={secret.secret} label="Copy secret" />
        <CopyButton text={authHeader} label="Copy Authorization header" />
      </div>
      <p className={styles.secretHint}>
        Tip: prefix the command with a space in your shell to keep it out of history.
      </p>
      <label className={styles.ackRow}>
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>I have copied the secret</span>
      </label>
      <div className={styles.modalActions}>
        <button type="button" className={styles.primaryBtn} disabled={!ack} onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

function RevokeModal({
  target,
  onCancel,
  onConfirm,
}: {
  target: ApiKeyMetadata;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal titleId="revoke-title" onClose={onCancel}>
      <div className={styles.modalHead}>
        <h2 id="revoke-title" className={styles.modalTitle}>Revoke API key</h2>
        <button type="button" className={styles.iconBtn} aria-label="Close" onClick={onCancel}>
          <X size={16} aria-hidden />
        </button>
      </div>
      <p className={styles.modalBody}>
        Revoke <strong>{target.label}</strong> (<span className={styles.mono}>{abbreviateId(target.keyId, 16)}</span>)?
        The key stops authenticating within ~60 s. Revoked keys stay visible here for audit history.
      </p>
      {error ? (
        <div className={styles.formError} role="alert">
          <AlertTriangle size={13} aria-hidden /> {error}
        </div>
      ) : null}
      <div className={styles.modalActions}>
        <button type="button" className={styles.ghostBtn} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.dangerBtn}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onConfirm();
            } catch (err) {
              setError(errorText(err));
              setBusy(false);
            }
          }}
        >
          {busy ? "Revoking…" : "Revoke key"}
        </button>
      </div>
    </Modal>
  );
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
    <div className={styles.overlay} onMouseDown={onClose ? (e) => e.target === e.currentTarget && onClose() : undefined}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {children}
      </div>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={styles.copyBtn}
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
    >
      {copied ? <Check size={13} color="var(--success)" aria-hidden /> : <Copy size={13} aria-hidden />}
      {copied ? "Copied" : label}
    </button>
  );
}

function errorText(err: unknown): string {
  if (err instanceof ApiCallError) {
    if (err.status === 400) return "Invalid request — check the client ID and label.";
    if (err.status === 401) return "Not authorized — check your API key.";
    return err.message;
  }
  return err instanceof Error ? err.message : "Request failed";
}
