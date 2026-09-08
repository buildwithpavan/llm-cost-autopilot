import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { buildProgram } from "@lca/cli";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");
const OPENAPI_PATH = path.join(
  REPO_ROOT,
  "specs/001-llm-routing-mvp/contracts/http-api.yaml",
);

interface OpenApi {
  paths: Record<string, unknown>;
}

interface CommandNode {
  name: string;
  commands?: CommandNode[];
  options: Array<{ long?: string; flags: string }>;
}

function toNode(cmd: {
  name(): string;
  commands: unknown[];
  options: Array<{ long?: string; flags: string }>;
}): CommandNode {
  return {
    name: cmd.name(),
    commands: cmd.commands.map((c) => toNode(c as never)),
    options: cmd.options,
  };
}

function collectLeafPaths(root: CommandNode): string[] {
  // Returns space-joined command paths, e.g., "telemetry query".
  const leaves: string[] = [];
  function walk(node: CommandNode, trail: string[]): void {
    if (!node.commands || node.commands.length === 0) {
      leaves.push([...trail, node.name].join(" ").trim());
      return;
    }
    for (const c of node.commands) walk(c, [...trail, node.name]);
  }
  for (const c of root.commands ?? []) walk(c, []);
  return leaves;
}

/** Per contracts/cli.md — mapping from HTTP path/verb → CLI leaf path. */
const HTTP_TO_CLI: ReadonlyArray<{ path: string; method: string; cliLeaf: string }> = [
  { path: "/v1/health", method: "get", cliLeaf: "health" },
  { path: "/v1/completions", method: "post", cliLeaf: "complete" },
  { path: "/v1/routing/preview", method: "post", cliLeaf: "route preview" },
  { path: "/v1/catalog", method: "get", cliLeaf: "catalog list" },
  { path: "/v1/telemetry/events", method: "get", cliLeaf: "telemetry query" },
  { path: "/v1/telemetry/rollups", method: "get", cliLeaf: "telemetry rollups" },
  {
    path: "/v1/telemetry/replay/{eventId}",
    method: "get",
    cliLeaf: "telemetry replay",
  },
  { path: "/v1/operator/rules", method: "get", cliLeaf: "rules list" },
  { path: "/v1/operator/rules", method: "post", cliLeaf: "rules add" },
  { path: "/v1/operator/rules/{ruleId}", method: "patch", cliLeaf: "rules update" },
  { path: "/v1/operator/rules/{ruleId}", method: "delete", cliLeaf: "rules delete" },
  { path: "/v1/keys", method: "get", cliLeaf: "keys list" },
  { path: "/v1/keys", method: "post", cliLeaf: "keys create" },
  { path: "/v1/keys/{keyId}", method: "delete", cliLeaf: "keys revoke" },
];

describe("CLI ↔ HTTP contract parity (T096)", () => {
  const rawSpec = readFileSync(OPENAPI_PATH, "utf8");
  const spec = parseYaml(rawSpec) as OpenApi;
  const cliRoot = toNode(buildProgram() as never);
  const cliLeaves = new Set(collectLeafPaths(cliRoot));

  it("every documented HTTP path/verb maps to a CLI leaf command", () => {
    const documented: Array<{ path: string; method: string }> = [];
    for (const [p, verbs] of Object.entries(spec.paths)) {
      for (const method of Object.keys(verbs as Record<string, unknown>)) {
        if (["get", "post", "patch", "delete", "put"].includes(method)) {
          documented.push({ path: p, method });
        }
      }
    }
    // /metrics is an internal Prometheus surface — not required to have a CLI mirror.
    // The parity mapping declared in HTTP_TO_CLI covers everything else.
    const missing: string[] = [];
    for (const doc of documented) {
      const mapping = HTTP_TO_CLI.find(
        (m) => m.path === doc.path && m.method === doc.method,
      );
      if (!mapping) {
        missing.push(`${doc.method.toUpperCase()} ${doc.path}`);
      }
    }
    expect(missing, "HTTP routes without a declared CLI mapping").toEqual([]);
  });

  it("every declared CLI leaf actually exists in the CLI command tree", () => {
    const missing: string[] = [];
    for (const m of HTTP_TO_CLI) {
      if (!cliLeaves.has(m.cliLeaf)) missing.push(m.cliLeaf);
    }
    expect(missing, "declared CLI leaves that the CLI doesn't implement").toEqual([]);
  });

  it("no undeclared CLI leaves exist (avoid drift)", () => {
    const declared = new Set(HTTP_TO_CLI.map((m) => m.cliLeaf));
    const extra: string[] = [];
    for (const leaf of cliLeaves) {
      if (leaf === "help" || leaf === "") continue;
      if (!declared.has(leaf)) extra.push(leaf);
    }
    expect(extra, "CLI leaves without a corresponding HTTP mapping").toEqual([]);
  });
});
