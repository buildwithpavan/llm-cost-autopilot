import { Decimal, type DecimalInstance } from "./decimal.js";

import type { PricingTable } from "../types/catalog.js";

const SIX_DP = new Decimal("0.000001");

export interface EstimateCostInput {
  readonly table: PricingTable;
  readonly providerId: string;
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Round to 6 decimal places using half-up rounding (Principle V centralization). */
export function roundToUsd6(value: DecimalInstance): DecimalInstance {
  const scaled = value.div(SIX_DP);
  // decimal.js-light exposes toDecimalPlaces via toFixed workaround
  const rounded = new Decimal(scaled.toFixed(0));
  return rounded.times(SIX_DP);
}

export function formatUsd(value: DecimalInstance): string {
  return roundToUsd6(value).toFixed(6).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export function estimateCostUsd(input: EstimateCostInput): string {
  const entry = input.table.entries.find(
    (e) => e.providerId === input.providerId && e.modelId === input.modelId,
  );
  if (!entry) {
    throw new Error(
      `no pricing entry for ${input.providerId}:${input.modelId} in pricing table ${input.table.versionId}`,
    );
  }
  const inputCost = new Decimal(input.inputTokens).times(entry.unitInputUsdPerToken);
  const outputCost = new Decimal(input.outputTokens).times(entry.unitOutputUsdPerToken);
  const total = inputCost.plus(outputCost);
  return formatUsd(total);
}
