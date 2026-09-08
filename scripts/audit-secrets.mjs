#!/usr/bin/env node
/**
 * End-to-end secret-leak audit (T101).
 *
 * 1. Inject a distinctive API-key value into env for the test run.
 * 2. Execute the full test suite in a subprocess capturing stdout+stderr.
 * 3. Optionally dump the current telemetry_events table via psql.
 * 4. Grep every byte of captured output for the exact secret value.
 * 5. Exit 0 iff zero matches; exit 1 otherwise.
 *
 * The audit is safe to run in CI: it runs the same test command CI uses.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SECRET = `sk-audit-${process.pid}-${Date.now()}-abcdefghij0123456789`;

const stdoutFile = path.join(tmpdir(), `lca-audit-stdout.${process.pid}.txt`);
const stderrFile = path.join(tmpdir(), `lca-audit-stderr.${process.pid}.txt`);

process.stderr.write(`[audit] running full suite with LCA_AUDIT_SECRET=${SECRET.slice(0, 12)}...\n`);

const child = spawnSync(
  "npx",
  ["vitest", "run"],
  {
    env: {
      ...process.env,
      LCA_AUDIT_SECRET: SECRET,
    },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  },
);

writeFileSync(stdoutFile, child.stdout ?? "");
writeFileSync(stderrFile, child.stderr ?? "");

let dumpText = "";
if (process.env.DATABASE_URL) {
  const psql = spawnSync(
    "psql",
    [process.env.DATABASE_URL, "-c", "SELECT * FROM telemetry_events LIMIT 10000"],
    { encoding: "utf8" },
  );
  dumpText = (psql.stdout ?? "") + (psql.stderr ?? "");
}

const combined = readFileSync(stdoutFile, "utf8") + readFileSync(stderrFile, "utf8") + dumpText;
const matches = combined.split(SECRET).length - 1;

try { unlinkSync(stdoutFile); } catch { /* ignore */ }
try { unlinkSync(stderrFile); } catch { /* ignore */ }

process.stderr.write(`[audit] test exit code: ${child.status ?? "?"}\n`);
process.stderr.write(`[audit] secret occurrences in captured output+db dump: ${matches}\n`);

if (matches > 0) {
  process.stderr.write("[audit] FAIL: secret leaked into captured output\n");
  process.exit(1);
}
if (child.status !== 0) {
  process.stderr.write("[audit] FAIL: test suite exited non-zero\n");
  process.exit(child.status ?? 1);
}
process.stderr.write("[audit] PASS\n");
process.exit(0);
