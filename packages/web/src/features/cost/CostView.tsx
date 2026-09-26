"use client";
import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Boxes, Coins, Hash, Server, ShieldCheck, Wallet } from "lucide-react";

import { AppShell } from "../../components/shell/AppShell.js";
import { TrackBar } from "../../components/primitives/index.js";
import { getEnvironment } from "../../lib/env.js";
import { formatUsd, formatTokens, formatInt, formatClockTime, formatRelativeTime } from "../../lib/format.js";
import { decisionSourceMeta, statusMeta, type Semantic } from "../routing-explorer/event-presenters.js";
import type { TelemetryEvent } from "../../types/index.js";
import type { ReconciliationMetrics } from "../../lib/api/metrics.js";
import type { CatalogResponse } from "../../lib/api/catalog.js";
import type { Async } from "../overview/overview-model.js";
import { useCostData, type CostRange } from "./useCostData.js";
import {
  deriveCostTotals,
  deriveModelCost,
  deriveProviderCost,
  formatMicroUsd,
  type CostGroup,
} from "./cost-model.js";
import styles from "./Cost.module.css";

const RANGE_OPTIONS: { value: CostRange; label: string }[] = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

/** Format integer micro-USD via the shared currency formatter. */
function usd(micro: number): string {
  return formatUsd(formatMicroUsd(micro));
}

export function CostView() {
  const env = useMemo(() => getEnvironment(), []);
  const { range, setRange, providerId, setProviderId, modelId, setModelId, window, events, metrics, catalog } =
    useCostData();

  const ready = events.status === "ready" ? events.data : null;
  const totals = useMemo(() => (ready ? deriveCostTotals(ready.events) : null), [ready]);
  const providers = useMemo(() => (ready ? deriveProviderCost(ready.events) : []), [ready]);
  const models = useMemo(() => (ready ? deriveModelCost(ready.events) : []), [ready]);

  const catalogData = catalog.status === "ready" ? catalog.data : null;
  const providerOptions = useMemo(
    () => (catalogData ? [...new Set(catalogData.models.map((m) => m.providerId))].sort() : []),
    [catalogData],
  );
  const modelOptions = useMemo(
    () =>
      catalogData
        ? [...new Set(catalogData.models.filter((m) => !providerId || m.providerId === providerId).map((m) => m.modelId))].sort()
        : [],
    [catalogData, providerId],
  );

  const connection =
    events.status === "loading" ? "connecting" : events.status === "error" ? "error" : "idle";

  const windowCount = ready?.events.length ?? 0;

  return (
    <AppShell
      connection={connection}
      envLabel={env.envLabel}
      healthy={events.status !== "error"}
      version={env.appVersion}
      activeKey="Cost"
    >
      <div className={styles.page}>
        <header className={styles.head}>
          <div>
            <div className={styles.kicker}>Cost</div>
            <h1 className={styles.title}>Cost Dashboard</h1>
            <p className={styles.subtitle}>
              Totals are aggregated across the selected event window — not lifetime spend.
            </p>
          </div>
          <div className={styles.filters}>
            <label className={styles.filter}>
              <span className={styles.filterLabel}>Range</span>
              <select className={styles.select} value={range} onChange={(e) => setRange(e.target.value as CostRange)}>
                {RANGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className={styles.filter}>
              <span className={styles.filterLabel}>Provider</span>
              <select
                className={styles.select}
                value={providerId}
                onChange={(e) => {
                  setProviderId(e.target.value);
                  setModelId("");
                }}
              >
                <option value="">All providers</option>
                {providerOptions.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className={styles.filter}>
              <span className={styles.filterLabel}>Model</span>
              <select className={styles.select} value={modelId} onChange={(e) => setModelId(e.target.value)}>
                <option value="">All models</option>
                {modelOptions.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <div className={styles.windowBar}>
          <span className={styles.windowLabel}>{window.label}</span>
          <span className={styles.windowMeta} title={`${formatClockTime(window.since)} – ${formatClockTime(window.until)}`}>
            {events.status === "ready" ? `${windowCount} request${windowCount === 1 ? "" : "s"} in window` : "…"}
          </span>
          {ready?.truncated ? (
            <span className={styles.truncated} role="status">
              <AlertTriangle size={12} aria-hidden /> Truncated at the fetch safety cap — totals below are a partial subset of this window.
            </span>
          ) : null}
        </div>

        {/* KPI row -------------------------------------------------------- */}
        <div className={styles.kpiRow}>
          <Kpi
            icon={<Wallet size={14} color="var(--accent-primary)" aria-hidden />}
            label="Estimated cost — selected window"
            section={events}
            value={totals ? usd(totals.estimatedMicroUsd) : ""}
          />
          <Kpi
            icon={<Coins size={14} color="var(--success)" aria-hidden />}
            label="Actual cost — selected window"
            section={events}
            value={totals ? usd(totals.actualMicroUsd) : ""}
            sub={totals ? `${totals.pendingActualCostCount} pending reconciliation` : undefined}
          />
          <Kpi
            icon={<Hash size={14} color="var(--accent-cyan)" aria-hidden />}
            label="Requests — selected window"
            section={events}
            value={totals ? formatInt(totals.requestCount) : ""}
          />
          <Kpi
            icon={<Boxes size={14} color="var(--accent-purple)" aria-hidden />}
            label="Total tokens — selected window"
            section={events}
            value={totals ? formatTokens(totals.totalTokens) : ""}
            sub={totals ? `${formatTokens(totals.inputTokens)} in · ${formatTokens(totals.outputTokens)} out` : undefined}
          />
        </div>

        {/* Provider + Model breakdowns ----------------------------------- */}
        <div className={styles.grid2}>
          <BreakdownPanel
            title="Provider breakdown"
            icon={<Server size={13} aria-hidden />}
            section={events}
            groups={providers}
            keyHeader="Provider"
          />
          <BreakdownPanel
            title="Model breakdown"
            icon={<Boxes size={13} aria-hidden />}
            section={events}
            groups={models}
            keyHeader="Model"
          />
        </div>

        {/* Reconciliation + Pricing -------------------------------------- */}
        <div className={styles.grid2}>
          <ReconciliationPanel metrics={metrics} totals={totals} />
          <PricingPanel catalog={catalog} />
        </div>

        {/* Recent requests ----------------------------------------------- */}
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <span>Requests in window</span>
            <Link href="/traffic" className={styles.inlineLink}>
              Open Routing Explorer <ArrowRight size={12} aria-hidden />
            </Link>
          </div>
          <RecentRequests section={events} />
        </div>
      </div>
    </AppShell>
  );
}

function Kpi({
  icon,
  label,
  section,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  section: Async<unknown>;
  value: string;
  sub?: string | undefined;
}) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiHead}>{icon} {label}</div>
      {section.status === "ready" ? (
        <>
          <div className={styles.kpiValue}>{value}</div>
          {sub ? <div className={styles.kpiSub}>{sub}</div> : null}
        </>
      ) : section.status === "error" ? (
        <div className={styles.kpiError}>Unavailable</div>
      ) : (
        <div className={styles.skelBar} />
      )}
    </div>
  );
}

function BreakdownPanel({
  title,
  icon,
  section,
  groups,
  keyHeader,
}: {
  title: string;
  icon: React.ReactNode;
  section: Async<unknown>;
  groups: CostGroup[];
  keyHeader: string;
}) {
  const maxEstimated = groups.reduce((m, g) => Math.max(m, g.estimatedMicroUsd), 0);
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <span>{icon} {title}</span>
      </div>
      {section.status === "loading" ? (
        <div className={styles.skelStack}>
          {Array.from({ length: 3 }, (_, i) => <div key={i} className={styles.skelBar} />)}
        </div>
      ) : section.status === "error" ? (
        <div className={styles.sectionError} role="alert">
          <AlertTriangle size={14} aria-hidden /> {(section as { message: string }).message}
        </div>
      ) : groups.length === 0 ? (
        <div className={styles.empty}>No requests in this window.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{keyHeader}</th>
                <th className={styles.num}>Requests</th>
                <th className={styles.num}>Tokens</th>
                <th className={styles.num}>Est. cost</th>
                <th className={styles.num}>Actual cost</th>
                <th className={styles.share} aria-label="Estimated cost share" />
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key}>
                  <td className={styles.mono} title={g.key}>{g.key}</td>
                  <td className={styles.num}>{formatInt(g.requestCount)}</td>
                  <td className={styles.num}>{formatTokens(g.totalTokens)}</td>
                  <td className={styles.num}>{usd(g.estimatedMicroUsd)}</td>
                  <td className={styles.num}>
                    {usd(g.actualMicroUsd)}
                    {g.pendingActualCostCount > 0 ? (
                      <span className={styles.pendTag} title={`${g.pendingActualCostCount} pending reconciliation`}>
                        {" "}·{g.pendingActualCostCount}p
                      </span>
                    ) : null}
                  </td>
                  <td className={styles.share}>
                    <TrackBar value={g.estimatedMicroUsd} max={maxEstimated || 1} color="var(--accent-primary)" width={90} height={8} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReconciliationPanel({
  metrics,
  totals,
}: {
  metrics: Async<ReconciliationMetrics>;
  totals: { reconciledCount: number; mismatchCount: number; pendingReconciliationCount: number } | null;
}) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <span><ShieldCheck size={13} color="var(--success)" aria-hidden /> Reconciliation</span>
      </div>
      <div className={styles.reconBody}>
        {metrics.status === "loading" ? (
          <div className={styles.skelBar} />
        ) : metrics.status === "error" ? (
          <div className={styles.unavailable}>Unavailable</div>
        ) : metrics.data.rate === null ? (
          <div className={styles.unavailable}>Unavailable — no reconciliation samples reported.</div>
        ) : (
          <>
            <div className={styles.reconRate}>{(metrics.data.rate * 100).toFixed(1)}%</div>
            <div className={styles.kpiSub}>authoritative rolling reconciled rate (current)</div>
            <div className={styles.reconAlert}>
              {metrics.data.alertActive === null ? (
                <span className={styles.unavailableInline}>alert state unavailable</span>
              ) : metrics.data.alertActive ? (
                <span className={styles.alertOn}>drift alert active</span>
              ) : (
                <span className={styles.alertOff}>within tolerance</span>
              )}
            </div>
          </>
        )}
      </div>
      {totals ? (
        <div className={styles.reconContext}>
          <span className={styles.contextLabel}>In selected window (context):</span>
          <span className={styles.ctxOk}>{totals.reconciledCount} reconciled</span>
          <span className={styles.ctxBad}>{totals.mismatchCount} mismatch</span>
          <span className={styles.ctxMuted}>{totals.pendingReconciliationCount} pending</span>
        </div>
      ) : null}
    </div>
  );
}

function PricingPanel({ catalog }: { catalog: Async<CatalogResponse> }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <span><Wallet size={13} color="var(--accent-cyan)" aria-hidden /> Active pricing</span>
      </div>
      <div className={styles.reconBody}>
        {catalog.status === "loading" ? (
          <div className={styles.skelBar} />
        ) : catalog.status === "error" ? (
          <div className={styles.unavailable}>Unavailable</div>
        ) : (
          <>
            <div className={styles.versionStat}>{catalog.data.pricingTableVersionId}</div>
            <div className={styles.kpiSub}>active pricing-table version</div>
            <div className={styles.footNote}>Effective-since and per-token prices are not exposed by the catalog API.</div>
          </>
        )}
      </div>
    </div>
  );
}

function RecentRequests({ section }: { section: Async<{ events: TelemetryEvent[]; truncated: boolean }> }) {
  if (section.status === "loading") {
    return (
      <div className={styles.skelStack}>
        {Array.from({ length: 4 }, (_, i) => <div key={i} className={styles.skelBar} />)}
      </div>
    );
  }
  if (section.status === "error") {
    return (
      <div className={styles.sectionError} role="alert">
        <AlertTriangle size={14} aria-hidden /> {section.message}
      </div>
    );
  }
  const rows = section.data.events.slice(0, 15);
  if (rows.length === 0) return <div className={styles.empty}>No requests in this window.</div>;
  return (
    <div className={styles.reqList}>
      {rows.map((e) => {
        const dec = decisionSourceMeta(e.decisionSource);
        const st = statusMeta(e);
        return (
          <Link key={e.eventId} href={`/traffic/${e.eventId}`} className={styles.reqRow}>
            <span className={styles.reqTime} title={formatClockTime(e.receivedAt)}>{formatRelativeTime(e.receivedAt)}</span>
            <span className={styles.reqModel}>{e.effectiveModelId}</span>
            <Badge meta={dec} />
            <Badge meta={st} />
            <span className={styles.reqMetric}>{formatUsd(e.estimatedCostUsd)}</span>
            <ArrowRight size={13} className={styles.reqArrow} aria-hidden />
          </Link>
        );
      })}
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
