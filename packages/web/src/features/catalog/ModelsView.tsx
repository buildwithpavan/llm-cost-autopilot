"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, Boxes, Search } from "lucide-react";

import { AppShell } from "../../components/shell/AppShell.js";
import { Chip, Mono, ProviderLogo, TrackBar } from "../../components/primitives/index.js";
import { getEnvironment } from "../../lib/env.js";
import { formatTokens, formatInt } from "../../lib/format.js";
import type { CatalogModel } from "../../lib/api/catalog.js";
import { useCatalog } from "./useCatalog.js";
import {
  QUALITY_TIERS,
  deriveProviderSummary,
  formatReliabilityPct,
  pricingVersion,
  publishedLatency,
  publishedReliability,
  type QualityTier,
} from "./catalog-model.js";
import styles from "./Models.module.css";

const CAPABILITY_OPTIONS = ["tool_use", "json_mode", "function_calling", "vision"] as const;

// Distinct, non-evaluative tier accents (tiers are a classification, not a ranking).
const TIER_COLOR: Record<QualityTier, string> = {
  low: "var(--text-secondary)",
  standard: "var(--accent-cyan)",
  high: "var(--accent-purple)",
};

export function ModelsView() {
  const env = useMemo(() => getEnvironment(), []);
  const { catalog, refresh } = useCatalog();

  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<"" | QualityTier>("");
  const [capability, setCapability] = useState("");

  const models = catalog.status === "ready" ? catalog.data.models : [];
  const providerSummaries = useMemo(() => deriveProviderSummary(models), [models]);
  const version = catalog.status === "ready" ? pricingVersion(catalog.data) : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter((m) => {
      if (q && !m.modelId.toLowerCase().includes(q) && !m.providerId.toLowerCase().includes(q)) return false;
      if (tier && m.qualityTier !== tier) return false;
      if (capability && !m.capabilities.includes(capability)) return false;
      return true;
    });
  }, [models, query, tier, capability]);

  const connection =
    catalog.status === "loading" ? "connecting" : catalog.status === "error" ? "error" : "idle";

  return (
    <AppShell
      connection={connection}
      envLabel={env.envLabel}
      healthy={catalog.status !== "error"}
      version={env.appVersion}
      activeKey="Models"
    >
      <div className={styles.page}>
        <header className={styles.head}>
          <div>
            <div className={styles.kicker}>Catalog</div>
            <h1 className={styles.title}>Models</h1>
            <p className={styles.subtitle}>Currently routable models from the active catalog.</p>
          </div>
          <div className={styles.pricing}>
            <span className={styles.pricingLabel}>Active pricing version</span>
            {version ? (
              <Mono size={12} color="var(--text-primary)">{version}</Mono>
            ) : (
              <span className={styles.unavailable}>Unavailable</span>
            )}
            <span className={styles.pricingNote}>Unit prices and effective dates are not exposed by the catalog API.</span>
          </div>
        </header>

        {/* Provider summary --------------------------------------------- */}
        {catalog.status === "ready" && providerSummaries.length > 0 ? (
          <section className={styles.providerSection} aria-label="Providers represented in the active catalog">
            <div className={styles.sectionLabel}>Providers represented in the active catalog</div>
            <div className={styles.providerGrid}>
              {providerSummaries.map((p) => (
                <div key={p.providerId} className={styles.providerCard}>
                  <div className={styles.providerHead}>
                    <ProviderLogo providerId={p.providerId} size={18} variant="bare" />
                    <Mono size={12} color="var(--text-primary)">{p.providerId}</Mono>
                  </div>
                  <div className={styles.providerMeta}>
                    {formatInt(p.modelCount)} model{p.modelCount === 1 ? "" : "s"}
                  </div>
                  <div className={styles.tierSpread}>
                    {QUALITY_TIERS.filter((t) => p.tierCounts[t] > 0).map((t) => (
                      <span key={t} className={styles.tierMini} style={{ color: TIER_COLOR[t] }}>
                        {p.tierCounts[t]} {t}
                      </span>
                    ))}
                  </div>
                  <div className={styles.capRow}>
                    {p.capabilities.map((c) => (
                      <Chip key={c} color="var(--accent-purple)" border="var(--accent-purple)">{c}</Chip>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Filters ------------------------------------------------------- */}
        <div className={styles.filters}>
          <label className={styles.searchWrap}>
            <Search size={14} className={styles.searchIcon} aria-hidden />
            <input
              className={styles.search}
              type="search"
              placeholder="Search model or provider"
              aria-label="Search models"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label className={styles.filter}>
            <span className={styles.filterLabel}>Tier</span>
            <select className={styles.select} value={tier} onChange={(e) => setTier(e.target.value as "" | QualityTier)}>
              <option value="">All tiers</option>
              {QUALITY_TIERS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className={styles.filter}>
            <span className={styles.filterLabel}>Capability</span>
            <select className={styles.select} value={capability} onChange={(e) => setCapability(e.target.value)}>
              <option value="">All capabilities</option>
              {CAPABILITY_OPTIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Models table -------------------------------------------------- */}
        <div className={styles.panel}>
          {catalog.status === "loading" ? (
            <div className={styles.skelStack} aria-busy="true" aria-label="Loading models">
              {Array.from({ length: 5 }, (_, i) => <div key={i} className={styles.skelBar} />)}
            </div>
          ) : catalog.status === "error" ? (
            <div className={styles.stateError} role="alert">
              <AlertTriangle size={16} aria-hidden />
              <div>
                <div className={styles.stateTitle}>Couldn’t load the catalog</div>
                <div className={styles.stateBody}>{catalog.message}</div>
              </div>
              <button type="button" className={styles.ghostBtn} onClick={refresh}>Retry</button>
            </div>
          ) : models.length === 0 ? (
            <div className={styles.empty}>
              <Boxes size={22} aria-hidden />
              <div className={styles.stateTitle}>No models currently available</div>
              <div className={styles.stateBody}>The active catalog returned no routable models.</div>
            </div>
          ) : filtered.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.stateTitle}>No models match these filters</div>
              <div className={styles.stateBody}>Adjust the search, tier, or capability filter.</div>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Provider</th>
                    <th>Quality tier</th>
                    <th>Capabilities</th>
                    <th className={styles.num}>Context (tokens)</th>
                    <th>Published latency</th>
                    <th>Published reliability</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((m) => (
                    <ModelRow key={`${m.providerId}:${m.modelId}`} model={m} />
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

function ModelRow({ model }: { model: CatalogModel }) {
  const lat = publishedLatency(model);
  const rel = publishedReliability(model);
  const tier = model.qualityTier;
  return (
    <tr>
      <td>
        <span className={styles.modelCell}>
          <ProviderLogo providerId={model.providerId} modelId={model.modelId} size={16} variant="bare" />
          <Mono size={12} color="var(--text-primary)">{model.modelId}</Mono>
        </span>
      </td>
      <td><Mono size={12} color="var(--text-secondary)">{model.providerId}</Mono></td>
      <td>
        <span
          className={styles.tierChip}
          style={{ color: TIER_COLOR[tier], borderColor: TIER_COLOR[tier] }}
        >
          {tier}
        </span>
      </td>
      <td>
        {model.capabilities.length === 0 ? (
          <span className={styles.muted}>none</span>
        ) : (
          <div className={styles.capRow}>
            {model.capabilities.map((c) => (
              <Chip key={c} color="var(--accent-purple)" border="var(--accent-purple)">{c}</Chip>
            ))}
          </div>
        )}
      </td>
      <td className={styles.num}>{formatTokens(model.contextWindow)}</td>
      <td>
        {lat ? (
          <div className={styles.published}>
            <span className={styles.publishedTag}>Published</span>
            <span className={styles.pubMetric}>p50 {lat.p50Ms}ms</span>
            <span className={styles.pubMetric}>p95 {lat.p95Ms}ms</span>
          </div>
        ) : (
          <span className={styles.unavailable}>Unavailable</span>
        )}
      </td>
      <td>
        {rel !== null ? (
          <div className={styles.published}>
            <span className={styles.pubMetric}>{formatReliabilityPct(rel)}</span>
            <span className={styles.publishedTag}>Published</span>
            <TrackBar value={rel} max={1} color="var(--accent-cyan)" width={70} height={6} />
          </div>
        ) : (
          <span className={styles.unavailable}>Unavailable</span>
        )}
      </td>
    </tr>
  );
}
