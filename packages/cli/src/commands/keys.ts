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

export function registerKeyCommands(program: Command): void {
  const keys = program.command("keys").description("manage API keys");

  keys
    .command("list")
    .description("list API keys (metadata only)")
    .action(async () => {
      const opts = program.opts<GlobalOpts>();
      const { body } = await request("GET", "/v1/keys", undefined, opts);
      emit(body);
    });

  const create = keys.command("create").description("mint a new API key");
  create.requiredOption("--client-id <id>");
  create.requiredOption("--label <label>");
  create.action(async () => {
    const opts = program.opts<GlobalOpts>();
    const { clientId, label } = create.opts<{ clientId: string; label: string }>();
    const { body } = await request("POST", "/v1/keys", { clientId, label }, opts);
    // The API returns { keyId, secret, ... } — print exactly once.
    // Hint the user to protect it before it hits shell history.
    process.stderr.write(
      "hint: the secret below is shown exactly once and cannot be retrieved later.\n" +
        "      consider prefixing this command with a space to skip HISTIGNORE.\n",
    );
    emit(body);
  });

  const revoke = keys.command("revoke").description("revoke an API key");
  revoke.argument("<keyId>", "key id");
  revoke.action(async (keyId: string) => {
    const opts = program.opts<GlobalOpts>();
    await request("DELETE", `/v1/keys/${keyId}`, undefined, opts);
  });
}
