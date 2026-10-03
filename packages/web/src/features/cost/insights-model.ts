import { formatUsd, formatInt, formatTokens } from "../../lib/format.js";
import { formatUtilizationPercent } from "./budget-model.js";
import type {
  CompatibilitySignal,
  InsightSeverity,
  InsightType,
  OptimizationInsight,
} from "../../lib/api/telemetry.js";

export const INSIGHT_TYPE_LABEL: Record<InsightType, string> = {
  cost_concentration: "Cost concentration",
  pricing_comparison: "Pricing comparison",
  budget_pressure: "Budget pressure",
};

export const INSIGHT_SEVERITY_LABEL: Record<InsightSeverity, string> = {
  info: "Info",
  warning: "Warning",
  critical: "Critical",
};

const COMPATIBILITY_LABEL: Record<CompatibilitySignal, string> = {
  none: "Price-only comparison — no compatibility signal established",
  catalog_superset: "Meets the observed model's catalog capabilities (catalog signal, not a routing guarantee)",
};

export interface InsightDetail {
  label: string;
  value: string;
}

/**
 * Presentation row for an optimization insight. Raw decimal strings are
 * preserved verbatim; `*Display` values format them at the presentation
 * boundary only (no money math here). Nothing here is imperative — insights are
 * advisory facts, never routing directives.
 */
export interface InsightRow {
  id: string;
  type: InsightType;
  typeLabel: string;
  severity: InsightSeverity;
  severityLabel: string;
  title: string;
  description: string;
  subject: string;
  magnitudeLabel: string;
  magnitudeDisplay: string;
  details: InsightDetail[];
  isPricingComparison: boolean;
  compatibilityLabel: string | null;
  assumptions: string[];
  /** Deep-link to the governance dry-run simulation, prefilled with the alternative pin. Advisory only. */
  simulateHref: string | null;
}

function simulationHref(providerId: string, modelId: string): string {
  const q = new URLSearchParams({ pinProviderId: providerId, pinModelId: modelId });
  return `/routing/preview?${q.toString()}`;
}

export function presentInsight(insight: OptimizationInsight): InsightRow {
  const base = {
    id: insight.id,
    type: insight.type,
    typeLabel: INSIGHT_TYPE_LABEL[insight.type],
    severity: insight.severity,
    severityLabel: INSIGHT_SEVERITY_LABEL[insight.severity],
    title: insight.title,
    description: insight.description,
    isPricingComparison: false,
    compatibilityLabel: null as string | null,
    assumptions: [] as string[],
    simulateHref: null as string | null,
  };

  switch (insight.type) {
    case "cost_concentration":
      return {
        ...base,
        subject: `${insight.providerId}:${insight.modelId}`,
        magnitudeLabel: "Share of window spend",
        magnitudeDisplay: formatUtilizationPercent(insight.shareRatio),
        details: [
          { label: "Estimated spend", value: formatUsd(insight.estimatedCostUsd) },
          { label: "Window total", value: formatUsd(insight.totalEstimatedCostUsd) },
          { label: "Requests", value: formatInt(insight.requestCount) },
        ],
      };
    case "pricing_comparison":
      return {
        ...base,
        subject: `${insight.providerId}:${insight.modelId}`,
        magnitudeLabel: "Potential cost difference",
        magnitudeDisplay: formatUsd(insight.costDifferenceUsd),
        isPricingComparison: true,
        compatibilityLabel: COMPATIBILITY_LABEL[insight.compatibilitySignal],
        assumptions: [...insight.assumptions],
        simulateHref: simulationHref(insight.alternativeProviderId, insight.alternativeModelId),
        details: [
          { label: "Lower-priced option", value: `${insight.alternativeProviderId}:${insight.alternativeModelId}` },
          { label: "Observed priced cost", value: formatUsd(insight.currentPricedCostUsd) },
          { label: "Alternative priced cost", value: formatUsd(insight.counterfactualEstimatedCostUsd) },
          { label: "Observed requests", value: formatInt(insight.observedRequestCount) },
          {
            label: "Observed tokens (in / out)",
            value: `${formatTokens(insight.observedInputTokens)} / ${formatTokens(insight.observedOutputTokens)}`,
          },
        ],
      };
    case "budget_pressure":
      return {
        ...base,
        subject: insight.scope === "global" ? "Global budget" : `Client budget${insight.clientId ? ` · ${insight.clientId}` : ""}`,
        magnitudeLabel: "Budget utilization",
        magnitudeDisplay: formatUtilizationPercent(insight.utilization),
        details: [
          { label: "Spend", value: formatUsd(insight.currentSpendUsd) },
          { label: "Limit", value: formatUsd(insight.limitUsd) },
          { label: "Remaining", value: formatUsd(insight.remainingUsd) },
          { label: "Period", value: insight.period === "daily" ? "Daily" : "Rolling 30d" },
        ],
      };
  }
}

export function presentInsights(insights: readonly OptimizationInsight[]): InsightRow[] {
  return insights.map(presentInsight);
}

/** Accessible, color-independent summary for a single insight row. */
export function insightAriaLabel(row: InsightRow): string {
  return [
    `${row.severityLabel} ${row.typeLabel.toLowerCase()}`,
    row.subject,
    `${row.magnitudeLabel} ${row.magnitudeDisplay}`,
  ].join(", ");
}
