import { readFileSync } from "node:fs";

import type { Command } from "commander";

interface GlobalOpts {
  json?: boolean;
  apiUrl?: string;
  apiKey?: string;
}

function baseUrl(opts: GlobalOpts): string {
  return opts.apiUrl ?? process.env["LCA_API_URL"] ?? "http://localhost:8080";
}

function bearer(opts: GlobalOpts): Record<string, string> {
  const token = opts.apiKey ?? process.env["LCA_API_KEY"];
  return token ? { authorization: `Bearer ${token}` } : {};
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

async function request(
  method: string,
  path: string,
  body: unknown,
  opts: GlobalOpts,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { ...bearer(opts) };
  if (body !== undefined) headers["content-type"] = "application/json";
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(baseUrl(opts) + path, init);
  const text = await res.text();
  const parsed = text ? safeJson(text) : null;
  if (!res.ok) {
    process.stderr.write(`request failed (${res.status}): ${text}\n`);
    process.exit(res.status === 401 ? 3 : 4);
  }
  return { status: res.status, body: parsed };
}

function emit(json: unknown): void {
  if (json === null || json === undefined) return;
  process.stdout.write(JSON.stringify(json, null, 2) + "\n");
}

function readJsonFile(path: string): unknown {
  const raw = path === "-" ? readFileSync(0, "utf8") : readFileSync(path, "utf8");
  return JSON.parse(raw);
}

export function registerRuleCommands(program: Command): void {
  const rules = program.command("rules").description("manage operator routing rules");

  rules
    .command("list")
    .description("list operator rules")
    .action(async () => {
      const opts = program.opts<GlobalOpts>();
      const { body } = await request("GET", "/v1/operator/rules", undefined, opts);
      emit(body);
    });

  const add = rules.command("add").description("add an operator rule");
  add.requiredOption("--file <path>", "path to a JSON rule body (or -)");
  add.action(async () => {
    const opts = program.opts<GlobalOpts>();
    const { file } = add.opts<{ file: string }>();
    const body = readJsonFile(file);
    const { body: created } = await request("POST", "/v1/operator/rules", body, opts);
    emit(created);
  });

  const update = rules.command("update").description("update an operator rule");
  update.argument("<ruleId>", "rule id");
  update.requiredOption("--file <path>", "path to a JSON patch body (or -)");
  update.action(async (ruleId: string) => {
    const opts = program.opts<GlobalOpts>();
    const { file } = update.opts<{ file: string }>();
    const body = readJsonFile(file);
    const { body: updated } = await request(
      "PATCH",
      `/v1/operator/rules/${ruleId}`,
      body,
      opts,
    );
    emit(updated);
  });

  const del = rules.command("delete").description("delete an operator rule");
  del.argument("<ruleId>", "rule id");
  del.action(async (ruleId: string) => {
    const opts = program.opts<GlobalOpts>();
    await request("DELETE", `/v1/operator/rules/${ruleId}`, undefined, opts);
  });
}
