#!/usr/bin/env node
/**
 * Scaffold a new provider adapter (T103).
 *
 * Usage:
 *   node scripts/scaffold-provider.mjs --name <providerId>
 *
 * Creates:
 *   packages/providers/src/<name>/adapter.ts   (stub implementing ProviderAdapter)
 *   packages/providers/test/<name>.contract.test.ts  (wires the shared contract suite)
 *   packages/providers/src/index.ts entry (best-effort append note)
 *
 * Prints instructions for wiring the adapter into the provider registry and
 * adding pricing entries to the active pricing snapshot.
 *
 * Note: this script deliberately does NOT edit `packages/core/**`.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name") out.name = argv[++i];
  }
  return out;
}

const { name } = parseArgs(process.argv.slice(2));
if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error("usage: scaffold-provider.mjs --name <lowercase-provider-id>");
  process.exit(2);
}

const srcDir = path.join(ROOT, "packages/providers/src", name);
if (existsSync(srcDir)) {
  console.error(`refusing to overwrite existing directory ${srcDir}`);
  process.exit(2);
}
mkdirSync(srcDir, { recursive: true });

const adapterPath = path.join(srcDir, "adapter.ts");
writeFileSync(
  adapterPath,
  `import type { Model, ErrorClass } from "@lca/core";
import { cost } from "@lca/core";

import type {
  ExecuteInput,
  ExecuteResult,
  ProviderAdapter,
} from "../abstraction/provider.js";

// TODO: fill with the models this adapter exposes.
const MODELS: readonly Model[] = [];

export interface ${camel(name)}AdapterOptions {
  apiKey: string;
}

export function create${camel(name)}Adapter(opts: ${camel(name)}AdapterOptions): ProviderAdapter {
  void opts;
  return {
    providerId: ${JSON.stringify(name)},
    listModels() {
      return MODELS;
    },
    async probeHealth(_signal: AbortSignal) {
      return {
        providerId: ${JSON.stringify(name)},
        healthy: true,
        lastProbedAt: new Date().toISOString(),
        consecutiveFailures: 0,
      };
    },
    async execute(input: ExecuteInput, _signal: AbortSignal): Promise<ExecuteResult> {
      void cost;
      const now = new Date().toISOString();
      return {
        kind: "failure",
        attempt: {
          attemptIndex: 0,
          providerId: ${JSON.stringify(name)},
          modelId: input.modelId,
          startedAt: now,
          endedAt: now,
          latencyMs: 0,
          inputTokens: null,
          outputTokens: null,
          errorClass: "provider_unavailable" satisfies ErrorClass,
          estimatedCostUsd: "0",
          actualCostUsd: null,
          pricingTableVersionId: input.pricingTable.versionId,
        },
      };
    },
  };
}
`,
);

const testDir = path.join(ROOT, "packages/providers/test");
mkdirSync(testDir, { recursive: true });
const testPath = path.join(testDir, `${name}.contract.test.ts`);
writeFileSync(
  testPath,
  `import type { PricingTable } from "@lca/core";
import { describe, it } from "vitest";

import { providerContractTests } from "../src/contract-tests/index.js";
import { create${camel(name)}Adapter } from "../src/${name}/adapter.js";

const PRICING: PricingTable = {
  versionId: "test-${name}",
  effectiveFrom: "2026-09-08T00:00:00.000Z",
  entries: [
    // TODO: add at least one pricing entry so C3/C7 can pass.
  ],
};

// TODO: fill in modelId to a value returned by listModels().
describe.skip("${name} contract (TODO: fill in modelId)", () => {
  providerContractTests(
    "${name}",
    () => create${camel(name)}Adapter({ apiKey: "test" }),
    { modelId: "TODO", pricingTable: PRICING },
  );
  it.skip("remove me once wired", () => {});
});
`,
);

console.log(`scaffolded provider ${name}:`);
console.log(`  ${path.relative(ROOT, adapterPath)}`);
console.log(`  ${path.relative(ROOT, testPath)}`);
console.log("");
console.log("next steps:");
console.log(`  1. Fill in MODELS in ${path.relative(ROOT, adapterPath)}`);
console.log(`  2. Implement execute() and probeHealth() as real calls`);
console.log(`  3. Register in packages/providers/src/index.ts and the API bootstrap`);
console.log(`  4. Add pricing entries under db/seeds/pricing/<date>.json`);
console.log(`  5. Fill in modelId in ${path.relative(ROOT, testPath)} and remove .skip`);
console.log("");
console.log("Reminder: do NOT modify packages/core/** as part of adding a provider.");

function camel(s) {
  return s.replace(/[-_](.)/g, (_m, c) => c.toUpperCase()).replace(/^./, (c) => c.toUpperCase());
}
