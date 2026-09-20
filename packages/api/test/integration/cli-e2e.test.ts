import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createApiKey,
  createDb,
  createOperatorRuleStore,
  createPool,
  createTelemetryWriter,
  runMigrations,
  setProviderHealth,
  type Db,
  type OperatorRuleStore,
  type TelemetryWriter,
} from "@lca/persistence";
import { createMockAdapter, createRegistry } from "@lca/providers";

import { buildServer } from "../../src/server.js";
import { loadConfig } from "../../src/config.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://lca:lca@localhost:5432/lca";
const gated = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");
// Runs the built binary (the actual shipped artifact); requires `npm run build`.
const CLI_ENTRY = path.join(REPO_ROOT, "packages/cli/dist/bin.js");

gated("CLI end-to-end integration (spawns the real lca binary)", () => {
  let db: Db;
  let pool: ReturnType<typeof createPool>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let writer: TelemetryWriter;
  let ruleStore: OperatorRuleStore;
  let adminSecret: string;
  let baseUrl: string;
  let tmp: string;

  /**
   * Run the built lca binary asynchronously. Async spawn is required: the API
   * server runs in this same event loop, so a synchronous child would deadlock
   * (the child's HTTP request could never be served).
   */
  async function cli(args: string[], env: Record<string, string> = {}): Promise<{ status: number; stdout: string; stderr: string }> {
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_ENTRY, ...args], {
        cwd: REPO_ROOT,
        env: { ...process.env, LCA_API_URL: baseUrl, LCA_API_KEY: adminSecret, ...env },
      });
      return { status: 0, stdout, stderr };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return { status: typeof e.code === "number" ? e.code : -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
  }

  beforeAll(async () => {
    await runMigrations(DATABASE_URL);
    pool = createPool(DATABASE_URL);
    db = createDb(pool);

    await db.deleteFrom("operator_rules").execute();
    await db.deleteFrom("api_keys").where("label", "like", "cli-e2e%").execute();
    await db.deleteFrom("telemetry_events").where("client_id", "=", "cli-e2e").execute();
    await setProviderHealth(db, "mock-cheap", true, 0);
    await setProviderHealth(db, "mock-fast", true, 0);

    const registry = createRegistry();
    registry.register(createMockAdapter({ providerId: "mock-cheap" }));
    registry.register(createMockAdapter({ providerId: "mock-fast" }));

    const created = await createApiKey(db, { clientId: "cli-e2e", label: "cli-e2e-admin" });
    adminSecret = created.secret;

    ruleStore = createOperatorRuleStore(db);
    writer = createTelemetryWriter(db, { batchSize: 1, flushEveryMs: 0 });
    app = await buildServer({
      config: loadConfig({ ...process.env, DATABASE_URL }),
      db,
      registry,
      telemetryWriter: writer,
      ruleStore,
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    tmp = mkdtempSync(path.join(tmpdir(), "lca-cli-e2e-"));
    writeFileSync(path.join(tmp, "msgs.json"), JSON.stringify([{ role: "user", content: "hello" }]));
    writeFileSync(path.join(tmp, "msgs-tool.json"), JSON.stringify([{ role: "user", content: "use a tool" }]));
    writeFileSync(
      path.join(tmp, "rule.json"),
      JSON.stringify({
        priority: 10,
        match: { clientIds: null, requiredCapabilities: ["tool_use"], minEstimatedTokens: null, maxEstimatedTokens: null },
        pin: { providerId: "mock-cheap", modelId: "mock-cheap:small" },
        enabled: true,
      }),
    );
    writeFileSync(path.join(tmp, "patch.json"), JSON.stringify({ enabled: false }));
  });

  beforeEach(async () => {
    // Each test starts from a clean rule table so precedence is deterministic.
    await db.deleteFrom("operator_rules").execute();
  });

  afterAll(async () => {
    await writer.close();
    await app.close();
    await db.destroy();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("keys create returns the secret once; keys list never exposes it", async () => {
    const created = await cli(["--json", "keys", "create", "--client-id", "cli-e2e-user", "--label", "cli-e2e-minted"]);
    expect(created.status).toBe(0);
    const body = JSON.parse(created.stdout) as { secret?: string; keyId?: string };
    expect(body.secret).toMatch(/^lca_sk_/);

    const listed = await cli(["--json", "keys", "list"]);
    expect(listed.status).toBe(0);
    const rows = JSON.parse(listed.stdout) as Array<Record<string, unknown>>;
    expect(Array.isArray(rows)).toBe(true);
    // Secret non-disclosure: no listed key carries a secret/hash field.
    for (const row of rows) {
      expect(row).not.toHaveProperty("secret");
      expect(row).not.toHaveProperty("hashedSecret");
      expect(row).not.toHaveProperty("hashed_secret");
    }
    expect(listed.stdout).not.toContain(body.secret);
  });

  it("rules add/list/update/delete lifecycle", async () => {
    const added = await cli(["--json", "rules", "add", "--file", path.join(tmp, "rule.json")]);
    expect(added.status).toBe(0);
    const ruleId = (JSON.parse(added.stdout) as { ruleId: string }).ruleId;
    expect(ruleId).toBeTruthy();

    const list1 = await cli(["--json", "rules", "list"]);
    expect(list1.status).toBe(0);
    expect((JSON.parse(list1.stdout) as Array<{ ruleId: string }>).some((r) => r.ruleId === ruleId)).toBe(true);

    const updated = await cli(["--json", "rules", "update", ruleId, "--file", path.join(tmp, "patch.json")]);
    expect(updated.status).toBe(0);
    expect((JSON.parse(updated.stdout) as { enabled: boolean }).enabled).toBe(false);

    const del = await cli(["rules", "delete", ruleId]);
    expect(del.status).toBe(0);

    const list2 = await cli(["--json", "rules", "list"]);
    expect((JSON.parse(list2.stdout) as Array<{ ruleId: string }>).some((r) => r.ruleId === ruleId)).toBe(false);
  });

  it("complete: autopilot, client override, and operator-rule precedence", async () => {
    const auto = await cli(["--json", "complete", "--messages-file", path.join(tmp, "msgs.json")]);
    expect(auto.status).toBe(0);
    expect((JSON.parse(auto.stdout) as { decision: { decisionSource: string } }).decision.decisionSource).toBe("autopilot");

    const client = await cli([
      "--json", "complete", "--messages-file", path.join(tmp, "msgs.json"),
      "--pin-provider", "mock-fast", "--pin-model", "mock-fast:default",
    ]);
    expect(client.status).toBe(0);
    const cbody = JSON.parse(client.stdout) as { modelId: string; decision: { decisionSource: string; shadowedSource: string | null } };
    expect(cbody.decision.decisionSource).toBe("client_override");
    expect(cbody.modelId).toBe("mock-fast:default");

    // Operator rule pinning tool_use → mock-cheap:small must shadow the client override.
    const addRule = await cli(["--json", "rules", "add", "--file", path.join(tmp, "rule.json")]);
    expect(addRule.status).toBe(0);
    const precedence = await cli([
      "--json", "complete", "--messages-file", path.join(tmp, "msgs-tool.json"),
      "--capability", "tool_use", "--pin-provider", "mock-fast", "--pin-model", "mock-fast:default",
    ]);
    expect(precedence.status).toBe(0);
    const pbody = JSON.parse(precedence.stdout) as { modelId: string; decision: { decisionSource: string; shadowedSource: string | null } };
    expect(pbody.decision.decisionSource).toBe("operator_rule");
    expect(pbody.decision.shadowedSource).toBe("client_override");
    expect(pbody.modelId).toBe("mock-cheap:small");
  });

  it("invalid override target exits 4 with a structured error", async () => {
    const res = await cli([
      "--json", "complete", "--messages-file", path.join(tmp, "msgs.json"),
      "--pin-provider", "nope", "--pin-model", "nope:nope",
    ]);
    expect(res.status).toBe(4);
    expect(res.stderr).toContain("override_target_missing");
  });

  it("unauthorized requests exit 3", async () => {
    const res = await cli(["--json", "keys", "list"], { LCA_API_KEY: "lca_sk_not_a_real_key" });
    expect(res.status).toBe(3);
    expect(res.stderr).toContain("401");
  });

  it("--help exits 0 and missing required options exit 1", async () => {
    const help = await cli(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("lca");

    const missing = await cli(["rules", "add"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/required option/i);
  });
});
