import type { ProviderHealthState } from "@lca/core";

import type { Db } from "../db/schema.js";

export async function readHealthyProviders(db: Db): Promise<ReadonlySet<string>> {
  const rows = await db
    .selectFrom("provider_health_state")
    .select(["provider_id", "healthy"])
    .where("healthy", "=", true)
    .execute();
  return new Set(rows.map((r) => r.provider_id));
}

/** Reads the latest persisted provider health for every provider (providerId asc). Read-only; never probes. */
export async function readProviderHealthStates(db: Db): Promise<ProviderHealthState[]> {
  const rows = await db
    .selectFrom("provider_health_state")
    .select(["provider_id", "healthy", "last_probed_at", "consecutive_failures"])
    .orderBy("provider_id", "asc")
    .execute();
  return rows.map((r) => ({
    providerId: r.provider_id,
    healthy: r.healthy,
    lastProbedAt: (r.last_probed_at as Date).toISOString(),
    consecutiveFailures: r.consecutive_failures,
  }));
}

export async function setProviderHealth(
  db: Db,
  providerId: string,
  healthy: boolean,
  consecutiveFailures: number,
): Promise<void> {
  await db
    .insertInto("provider_health_state")
    .values({
      provider_id: providerId,
      healthy,
      last_probed_at: new Date(),
      consecutive_failures: consecutiveFailures,
    })
    .onConflict((oc) =>
      oc.column("provider_id").doUpdateSet({
        healthy,
        last_probed_at: new Date(),
        consecutive_failures: consecutiveFailures,
        updated_at: new Date(),
      }),
    )
    .execute();
}
