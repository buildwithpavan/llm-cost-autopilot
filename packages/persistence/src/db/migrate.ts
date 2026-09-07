import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import pg from "pg";

const { Pool } = pg;

async function findMigrationsDir(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Walk up until we find a `db/migrations` directory. Works from `dist/` and `src/`.
  let dir = here;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "db", "migrations");
    try {
      const stat = await readdir(candidate);
      if (stat.length > 0) return candidate;
    } catch {
      // continue up
    }
    dir = path.dirname(dir);
  }
  throw new Error("Cannot locate db/migrations directory");
}

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
    );
    const dir = await findMigrationsDir();
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const filename of files) {
      const already = await client.query(
        `SELECT 1 FROM schema_migrations WHERE filename = $1`,
        [filename],
      );
      if (already.rowCount) continue;
      const sql = await readFile(path.join(dir, filename), "utf8");
      // Migrations manage their own BEGIN/COMMIT.
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (filename) VALUES ($1)`,
        [filename],
      );
       
      console.log(`applied ${filename}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  runMigrations(url).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
