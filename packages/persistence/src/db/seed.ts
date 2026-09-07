import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createPool, createDb } from "./schema.js";

interface SeedPricing {
  priceListDate: string;
  versionIdPrefix: string;
  entries: Array<{
    providerId: string;
    modelId: string;
    unitInputUsdPerToken: string;
    unitOutputUsdPerToken: string;
  }>;
}

async function findSeedsDir(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "db", "seeds", "pricing");
    try {
      const stat = await readdir(candidate);
      if (stat.length > 0) return candidate;
    } catch {
      // continue up
    }
    dir = path.dirname(dir);
  }
  throw new Error("Cannot locate db/seeds/pricing directory");
}

export async function seed(databaseUrl: string): Promise<void> {
  const pool = createPool(databaseUrl);
  const db = createDb(pool);
  try {
    const dir = await findSeedsDir();
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
    for (const file of files) {
      const raw = await readFile(path.join(dir, file), "utf8");
      const parsed = JSON.parse(raw) as SeedPricing;
      const versionId = parsed.versionIdPrefix;
      const existing = await db
        .selectFrom("pricing_tables")
        .select("version_id")
        .where("version_id", "=", versionId)
        .executeTakeFirst();
      if (existing) {
         
        console.log(`skip ${file}: version ${versionId} already present`);
        continue;
      }
      await db.transaction().execute(async (tx) => {
        await tx
          .insertInto("pricing_tables")
          .values({
            version_id: versionId,
            effective_from: new Date(parsed.priceListDate),
            is_active: false,
          })
          .execute();
        await tx
          .insertInto("pricing_entries")
          .values(
            parsed.entries.map((e) => ({
              version_id: versionId,
              provider_id: e.providerId,
              model_id: e.modelId,
              unit_input_usd_per_token: e.unitInputUsdPerToken,
              unit_output_usd_per_token: e.unitOutputUsdPerToken,
              currency: "USD",
            })),
          )
          .execute();
        await tx
          .updateTable("pricing_tables")
          .set({ is_active: false })
          .where("is_active", "=", true)
          .execute();
        await tx
          .updateTable("pricing_tables")
          .set({ is_active: true })
          .where("version_id", "=", versionId)
          .execute();
      });
       
      console.log(`seeded ${file} as version ${versionId} (active)`);
    }

    // Seed a mock provider health entry so the catalog is populated for dev.
    for (const providerId of ["mock-cheap", "mock-fast"]) {
      await db
        .insertInto("provider_health_state")
        .values({
          provider_id: providerId,
          healthy: true,
          last_probed_at: new Date(),
          consecutive_failures: 0,
        })
        .onConflict((oc) => oc.column("provider_id").doNothing())
        .execute();
    }
  } finally {
    await db.destroy();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  seed(url).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
