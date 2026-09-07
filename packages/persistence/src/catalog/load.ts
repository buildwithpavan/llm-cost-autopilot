import type { Model, PricingTable } from "@lca/core";

import type { Db } from "../db/schema.js";

export async function loadActivePricingTable(db: Db): Promise<PricingTable> {
  const table = await db
    .selectFrom("pricing_tables")
    .select(["version_id", "effective_from"])
    .where("is_active", "=", true)
    .executeTakeFirst();
  if (!table) {
    throw new Error("no active pricing table");
  }
  const rows = await db
    .selectFrom("pricing_entries")
    .selectAll()
    .where("version_id", "=", table.version_id)
    .execute();
  return {
    versionId: table.version_id,
    effectiveFrom: table.effective_from.toISOString(),
    entries: rows.map((r) => ({
      providerId: r.provider_id,
      modelId: r.model_id,
      unitInputUsdPerToken: r.unit_input_usd_per_token,
      unitOutputUsdPerToken: r.unit_output_usd_per_token,
      currency: "USD",
    })),
  };
}

/**
 * Merge each adapter's static models with the active pricing entries.
 * Drops (with a warning callback) any model that lacks a matching pricing entry (Principle V).
 */
export interface CatalogInput {
  models: readonly Model[];
  pricingTable: PricingTable;
  onDropped?: (droppedModelId: string, reason: string) => void;
  healthyProviders?: ReadonlySet<string>;
}

export function buildCatalog(input: CatalogInput): readonly Model[] {
  const catalog: Model[] = [];
  for (const model of input.models) {
    if (input.healthyProviders && !input.healthyProviders.has(model.providerId)) {
      input.onDropped?.(model.modelId, "provider unhealthy");
      continue;
    }
    const priced = input.pricingTable.entries.find(
      (e) => e.providerId === model.providerId && e.modelId === model.modelId,
    );
    if (!priced) {
      input.onDropped?.(
        model.modelId,
        `no pricing entry in table ${input.pricingTable.versionId}`,
      );
      continue;
    }
    catalog.push(model);
  }
  return catalog;
}
