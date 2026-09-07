import type { Db } from "@lca/persistence";
import type { FastifyPluginAsync } from "fastify";

interface HealthDeps {
  db: Db;
}

/** Returns 200 when DB reachable AND an active pricing table exists. */
const health: FastifyPluginAsync<HealthDeps> = async (fastify, opts) => {
  fastify.get("/v1/health", async (_req, reply) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    let allOk = true;
    try {
      await opts.db.selectFrom("pricing_tables").select("version_id").limit(1).execute();
      checks["db"] = { ok: true };
    } catch (err) {
      allOk = false;
      checks["db"] = { ok: false, detail: (err as Error).message };
    }

    try {
      const row = await opts.db
        .selectFrom("pricing_tables")
        .select("version_id")
        .where("is_active", "=", true)
        .executeTakeFirst();
      if (row) {
        checks["pricing_active"] = { ok: true };
      } else {
        allOk = false;
        checks["pricing_active"] = { ok: false, detail: "no active pricing table" };
      }
    } catch (err) {
      allOk = false;
      checks["pricing_active"] = { ok: false, detail: (err as Error).message };
    }

    const body = { status: allOk ? "ok" : "degraded", checks };
    return reply.status(allOk ? 200 : 503).send(body);
  });
};

export default health;
