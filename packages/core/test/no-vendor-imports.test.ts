import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const FORBIDDEN_SPECIFIERS = ["openai", "@anthropic-ai/sdk"];
const ALLOWED_DIRS = [
  path.join(ROOT, "packages/providers/src/openai"),
  path.join(ROOT, "packages/providers/src/anthropic"),
];

const SCAN_DIRS = [
  path.join(ROOT, "packages/core/src"),
  path.join(ROOT, "packages/persistence/src"),
  path.join(ROOT, "packages/api/src"),
  path.join(ROOT, "packages/cli/src"),
  path.join(ROOT, "packages/providers/src/abstraction"),
  path.join(ROOT, "packages/providers/src/contract-tests"),
  path.join(ROOT, "packages/providers/src/mock"),
  path.join(ROOT, "packages/providers/src/registry.ts"),
  path.join(ROOT, "packages/providers/src/index.ts"),
];

function walk(dir: string): string[] {
  try {
    const stat = statSync(dir);
    if (stat.isFile()) return dir.endsWith(".ts") ? [dir] : [];
  } catch {
    return [];
  }
  const out: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...walk(full));
    } else if (e.isFile() && full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function isAllowed(file: string): boolean {
  return ALLOWED_DIRS.some((d) => file.startsWith(d));
}

const IMPORT_RE = /(?:^|\n)\s*import\s+[^;]*?from\s+["']([^"']+)["']/g;

describe("vendor-SDK import boundary (T102 / Principle VI)", () => {
  const offenders: Array<{ file: string; specifier: string }> = [];
  for (const target of SCAN_DIRS) {
    for (const file of walk(target)) {
      if (isAllowed(file)) continue;
      const src = readFileSync(file, "utf8");
      let m: RegExpExecArray | null;
      IMPORT_RE.lastIndex = 0;
      while ((m = IMPORT_RE.exec(src)) !== null) {
        const spec = m[1]!;
        if (FORBIDDEN_SPECIFIERS.includes(spec)) {
          offenders.push({ file: path.relative(ROOT, file), specifier: spec });
        }
      }
    }
  }

  it("no core/persistence/api/cli/provider-shared file imports vendor SDKs", () => {
    expect(offenders, `unexpected vendor SDK imports: ${JSON.stringify(offenders, null, 2)}`).toEqual([]);
  });

  it("the only openai importer is packages/providers/src/openai/adapter.ts", () => {
    const openaiImporters: string[] = [];
    for (const file of walk(path.join(ROOT, "packages"))) {
      if (file.includes("/dist/") || file.includes("/node_modules/") || file.includes("/test/")) continue;
      const src = readFileSync(file, "utf8");
      if (/from\s+["']openai["']/.test(src)) openaiImporters.push(path.relative(ROOT, file));
    }
    expect(openaiImporters).toEqual(["packages/providers/src/openai/adapter.ts"]);
  });

  it("the only @anthropic-ai/sdk importer is packages/providers/src/anthropic/adapter.ts", () => {
    const anthropicImporters: string[] = [];
    for (const file of walk(path.join(ROOT, "packages"))) {
      if (file.includes("/dist/") || file.includes("/node_modules/") || file.includes("/test/")) continue;
      const src = readFileSync(file, "utf8");
      if (/from\s+["']@anthropic-ai\/sdk["']/.test(src)) anthropicImporters.push(path.relative(ROOT, file));
    }
    expect(anthropicImporters).toEqual(["packages/providers/src/anthropic/adapter.ts"]);
  });
});
