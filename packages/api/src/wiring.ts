import type { PricingTable, Model } from "@lca/core";
import type { Db, OperatorRuleStore } from "@lca/persistence";
import { buildCatalog, loadActivePricingTable, readHealthyProviders } from "@lca/persistence";
import type { ProviderRegistry } from "@lca/providers";

export interface AppContext {
  db: Db;
  registry: ProviderRegistry;
  ruleStore?: OperatorRuleStore;
}

export interface CatalogSnapshot {
  models: readonly Model[];
  pricingTable: PricingTable;
}

/**
 * Loads the current catalog (models with pricing + healthy providers only).
 * Called per-request (Principle V: version pinned at ingress).
 */
export async function loadCatalogSnapshot(ctx: AppContext): Promise<CatalogSnapshot> {
  const [pricingTable, healthyProviders] = await Promise.all([
    loadActivePricingTable(ctx.db),
    readHealthyProviders(ctx.db),
  ]);
  const staticModels = ctx.registry.list().flatMap((a) => a.listModels());
  const models = buildCatalog({
    models: staticModels,
    pricingTable,
    healthyProviders,
  });
  return { models, pricingTable };
}
