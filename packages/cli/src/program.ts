import { readFileSync } from "node:fs";

import { Command } from "commander";

import { registerKeyCommands } from "./commands/keys.js";
import { registerRuleCommands } from "./commands/rules.js";
import { registerTelemetryCommands } from "./commands/telemetry.js";

interface GlobalOpts {
  json?: boolean;
  apiUrl?: string;
  apiKey?: string;
  verbose?: boolean;
}

function readMessagesFile(path: string): unknown {
  const raw = path === "-" ? readFrom(process.stdin) : readFileSync(path, "utf8");
  return JSON.parse(raw);
}

function readFrom(stream: NodeJS.ReadableStream): string {
  const chunks: Buffer[] = [];
  const it = stream as unknown as { read(): Buffer | null };
  let chunk = it.read();
  while (chunk !== null) {
    chunks.push(chunk);
    chunk = it.read();
  }
  return Buffer.concat(chunks).toString("utf8");
}

function baseUrl(opts: GlobalOpts): string {
  return opts.apiUrl ?? process.env["LCA_API_URL"] ?? "http://localhost:8080";
}

function bearer(opts: GlobalOpts): Record<string, string> {
  const token = opts.apiKey ?? process.env["LCA_API_KEY"];
  return token ? { authorization: `Bearer ${token}` } : {};
}

function emit(json: unknown, opts: GlobalOpts): void {
  if (opts.json) {
    process.stdout.write(JSON.stringify(json, null, 2) + "\n");
  } else if (typeof json === "string") {
    process.stdout.write(json + "\n");
  } else {
    process.stdout.write(JSON.stringify(json, null, 2) + "\n");
  }
}

async function post(path: string, body: unknown, opts: GlobalOpts): Promise<unknown> {
  const res = await fetch(baseUrl(opts) + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...bearer(opts) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const parsed = text ? safeJson(text) : null;
  if (!res.ok) {
    process.stderr.write(`request failed (${res.status}): ${text}\n`);
    process.exit(res.status === 401 ? 3 : 4);
  }
  return parsed;
}

async function get(path: string, opts: GlobalOpts): Promise<unknown> {
  const res = await fetch(baseUrl(opts) + path, { headers: bearer(opts) });
  const text = await res.text();
  const parsed = text ? safeJson(text) : null;
  if (!res.ok) {
    process.stderr.write(`request failed (${res.status}): ${text}\n`);
    process.exit(res.status === 401 ? 3 : 4);
  }
  return parsed;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("lca")
    .description("LLM Cost Autopilot CLI")
    .option("--json", "emit JSON on stdout")
    .option("--api-url <url>", "target API base URL")
    .option("--api-key <token>", "bearer token")
    .option("-v, --verbose", "increase log level");

  program
    .command("health")
    .description("liveness + dependency health probe")
    .action(async () => {
      const opts = program.opts<GlobalOpts>();
      const body = await get("/v1/health", opts);
      emit(body, opts);
      const status = (body as { status?: string })?.status;
      if (status !== "ok") process.exit(1);
    });

  const complete = program
    .command("complete")
    .description("route and execute a completion request")
    .option("--messages-file <path>", "path to a JSON array of messages (or -)")
    .option("--max-latency-ms <n>", "max acceptable latency in ms")
    .option("--max-cost-usd <d>", "max acceptable cost per request")
    .option(
      "--min-quality <tier>",
      "minimum quality tier (low|standard|high)",
    )
    .option("--capability <caps>", "comma-separated required capabilities")
    .option("--pin-provider <id>", "override provider")
    .option("--pin-model <id>", "override model");

  complete.action(async () => {
    const opts = program.opts<GlobalOpts>();
    const local = complete.opts<{
      messagesFile: string;
      maxLatencyMs?: string;
      maxCostUsd?: string;
      minQuality?: string;
      capability?: string;
      pinProvider?: string;
      pinModel?: string;
    }>();
    const messages = readMessagesFile(local.messagesFile);
    const body: Record<string, unknown> = { messages };
    const requirements: Record<string, unknown> = {};
    if (local.maxLatencyMs) requirements["maxLatencyMs"] = Number(local.maxLatencyMs);
    if (local.maxCostUsd) requirements["maxCostUsd"] = String(local.maxCostUsd);
    if (local.minQuality) requirements["minQualityTier"] = local.minQuality;
    if (local.capability) requirements["requiredCapabilities"] = local.capability.split(",");
    if (Object.keys(requirements).length) body["requirements"] = requirements;
    if (local.pinProvider || local.pinModel) {
      body["override"] = { providerId: local.pinProvider ?? null, modelId: local.pinModel ?? null };
    }
    emit(await post("/v1/completions", body, opts), opts);
  });

  const route = program.command("route").description("routing utilities");
  const preview = route.command("preview").description("dry-run routing without executing");
  preview.option("--messages-file <path>", "path to a JSON array of messages (or -)");
  preview.action(async () => {
    const opts = program.opts<GlobalOpts>();
    const { messagesFile } = preview.opts<{ messagesFile: string }>();
    const messages = readMessagesFile(messagesFile);
    emit(await post("/v1/routing/preview", { messages }, opts), opts);
  });

  const catalog = program.command("catalog").description("catalog inspection");
  catalog
    .command("list")
    .description("list the configured provider/model catalog")
    .action(async () => {
      const opts = program.opts<GlobalOpts>();
      emit(await get("/v1/catalog", opts), opts);
    });

  registerTelemetryCommands(program);
  registerRuleCommands(program);
  registerKeyCommands(program);

  return program;
}
