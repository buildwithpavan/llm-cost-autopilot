import type { Db } from "../db/schema.js";

export async function readHealthyProviders(db: Db): Promise<ReadonlySet<string>> {
  const rows = await db
    .selectFrom("provider_health_state")
    .select(["provider_id", "healthy"])
    .where("healthy", "=", true)
    .execute();
  return new Set(rows.map((r) => r.provider_id));
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
