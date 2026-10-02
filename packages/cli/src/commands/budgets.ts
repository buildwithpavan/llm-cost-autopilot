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
): Promise<unknown> {
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
  return parsed;
}

function emit(json: unknown): void {
  if (json === null || json === undefined) return;
  process.stdout.write(JSON.stringify(json, null, 2) + "\n");
}

export function registerBudgetCommands(program: Command): void {
  const budgets = program
    .command("budgets")
    .description("manage spend budgets (global/client, daily/rolling_30d, block/warn)");

  budgets
    .command("list")
    .description("list all configured budgets")
    .action(async () => {
      emit(await request("GET", "/v1/budgets", undefined, program.opts<GlobalOpts>()));
    });

  const get = budgets.command("get").description("show one budget by id");
  get.argument("<id>", "budget id");
  get.action(async (id: string) => {
    emit(await request("GET", `/v1/budgets/${id}`, undefined, program.opts<GlobalOpts>()));
  });

  const create = budgets
    .command("create")
    .description("create a budget")
    // Examples:
    //   budgets create --scope global --period daily --limit-usd 25.000000 --action warn
    //   budgets create --scope client --client-id acme --period rolling_30d --limit-usd 100 --action block
    .requiredOption("--scope <global|client>")
    .option("--client-id <id>", "required when --scope client")
    .requiredOption("--period <daily|rolling_30d>")
    .requiredOption("--limit-usd <decimal>", "decimal USD, e.g. 25.000000 (never floated)")
    .requiredOption("--action <block|warn>")
    .option("--disabled", "create the budget disabled", false);
  create.action(async () => {
    const o = create.opts<{
      scope: string;
      clientId?: string;
      period: string;
      limitUsd: string;
      action: string;
      disabled?: boolean;
    }>();
    const body: Record<string, unknown> = {
      scope: o.scope,
      period: o.period,
      limitUsd: o.limitUsd, // decimal string, passed through verbatim
      action: o.action,
      enabled: !o.disabled,
    };
    if (o.clientId) body["clientId"] = o.clientId;
    emit(await request("POST", "/v1/budgets", body, program.opts<GlobalOpts>()));
  });

  const update = budgets.command("update").description("update mutable budget fields");
  update.argument("<id>", "budget id");
  update
    .option("--scope <global|client>")
    .option("--client-id <id>")
    .option("--period <daily|rolling_30d>")
    .option("--limit-usd <decimal>")
    .option("--action <block|warn>")
    .option("--enabled", "enable the budget")
    .option("--disabled", "disable the budget");
  update.action(async (id: string) => {
    const o = update.opts<{
      scope?: string;
      clientId?: string;
      period?: string;
      limitUsd?: string;
      action?: string;
      enabled?: boolean;
      disabled?: boolean;
    }>();
    const patch: Record<string, unknown> = {};
    if (o.scope !== undefined) patch["scope"] = o.scope;
    if (o.clientId !== undefined) patch["clientId"] = o.clientId;
    if (o.period !== undefined) patch["period"] = o.period;
    if (o.limitUsd !== undefined) patch["limitUsd"] = o.limitUsd;
    if (o.action !== undefined) patch["action"] = o.action;
    if (o.enabled) patch["enabled"] = true;
    if (o.disabled) patch["enabled"] = false;
    emit(await request("PATCH", `/v1/budgets/${id}`, patch, program.opts<GlobalOpts>()));
  });

  const del = budgets.command("delete").description("delete a budget");
  del.argument("<id>", "budget id");
  del.action(async (id: string) => {
    await request("DELETE", `/v1/budgets/${id}`, undefined, program.opts<GlobalOpts>());
  });

  budgets
    .command("status")
    .description("show current spend/utilization for applicable budgets (read-only)")
    .action(async () => {
      emit(await request("GET", "/v1/budgets/status", undefined, program.opts<GlobalOpts>()));
    });
}
