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

function emit(json: unknown, opts: GlobalOpts): void {
  const out = JSON.stringify(json, null, 2) + "\n";
  if (opts.json || !process.stdout.isTTY) {
    process.stdout.write(out);
  } else {
    process.stdout.write(out);
  }
}

export function registerTelemetryCommands(program: Command): void {
  const tele = program
    .command("telemetry")
    .description("inspect telemetry, rollups, and replay past decisions");

  const query = tele
    .command("query")
    .description("query full-fidelity telemetry events (30-day window)");
  query
    .option("--client-id <id>")
    .option("--provider-id <id>")
    .option("--model-id <id>")
    .option("--since <rfc3339>")
    .option("--until <rfc3339>")
    .option("--limit <n>", "1-500", "100")
    .option("--cursor <c>");
  query.action(async () => {
    const opts = program.opts<GlobalOpts>();
    const local = query.opts<{
      clientId?: string;
      providerId?: string;
      modelId?: string;
      since?: string;
      until?: string;
      limit?: string;
      cursor?: string;
    }>();
    const params = new URLSearchParams();
    if (local.clientId) params.set("clientId", local.clientId);
    if (local.providerId) params.set("providerId", local.providerId);
    if (local.modelId) params.set("modelId", local.modelId);
    if (local.since) params.set("since", local.since);
    if (local.until) params.set("until", local.until);
    if (local.limit) params.set("limit", local.limit);
    if (local.cursor) params.set("cursor", local.cursor);
    const path = `/v1/telemetry/events${params.size ? "?" + params.toString() : ""}`;
    emit(await get(path, opts), opts);
  });

  const rollups = tele.command("rollups").description("query daily rollups (12-month window)");
  rollups
    .option("--provider-id <id>")
    .option("--model-id <id>")
    .option("--from <YYYY-MM-DD>")
    .option("--to <YYYY-MM-DD>");
  rollups.action(async () => {
    const opts = program.opts<GlobalOpts>();
    const local = rollups.opts<{
      providerId?: string;
      modelId?: string;
      from?: string;
      to?: string;
    }>();
    const params = new URLSearchParams();
    if (local.providerId) params.set("providerId", local.providerId);
    if (local.modelId) params.set("modelId", local.modelId);
    if (local.from) params.set("fromDate", local.from);
    if (local.to) params.set("toDate", local.to);
    const path = `/v1/telemetry/rollups${params.size ? "?" + params.toString() : ""}`;
    emit(await get(path, opts), opts);
  });

  const replay = tele
    .command("replay")
    .description("replay a stored routing decision (does NOT call any provider)");
  replay.argument("<eventId>", "telemetry event UUID");
  replay.action(async (eventId: string) => {
    const opts = program.opts<GlobalOpts>();
    const body = (await get(`/v1/telemetry/replay/${eventId}`, opts)) as {
      matches?: boolean;
    };
    emit(body, opts);
    // Exit non-zero on divergence per contracts/cli.md.
    if (body && body.matches === false) process.exit(1);
  });
}
