#!/usr/bin/env node
/**
 * Post-deployment smoke test for a deployed LLM Cost Autopilot stack.
 *
 * Runs a deterministic, read-mostly sequence of checks against an already
 * deployed frontend + API (e.g. the Render + Supabase staging shape prepared in
 * docs/operations.md). It performs NO deployment, accesses NO external accounts,
 * and introduces NO credentials of its own — the operator supplies the deployed
 * URLs and a demo API key.
 *
 * Usage:
 *   node scripts/smoke-deployment.mjs \
 *     --web-url https://lca-web.onrender.com \
 *     --api-url https://lca-api.onrender.com \
 *     --api-key <demo-key>
 *
 * All options may instead be supplied via environment variables:
 *   LCA_SMOKE_WEB_URL         frontend base URL           (--web-url)
 *   LCA_SMOKE_API_URL         API base URL                (--api-url)
 *   LCA_SMOKE_API_KEY         demo bearer key             (--api-key)
 *   LCA_SMOKE_TIMEOUT_MS      per-request timeout ms      (--timeout-ms, default 30000)
 *   LCA_SMOKE_WARMUP_RETRIES  cold-start retries per req  (--warmup-retries, default 5)
 *   LCA_SMOKE_PROVIDERS       optional paid providers to  (--providers, e.g. "gemini,groq")
 *                             exercise (comma separated)
 *
 * Prefer passing the key via the environment (LCA_SMOKE_API_KEY) so it never
 * lands in your shell history. The key and all Authorization headers are
 * redacted from every line this script prints.
 *
 * Exit code: 0 when every required check (and every explicitly requested
 * optional provider check) passes; 1 otherwise. Never makes destructive or
 * key-mutating requests; TLS verification is never disabled.
 */
import { randomUUID } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_WARMUP_RETRIES = 5;
// Pinned mock target — always registered (even in production) and always priced,
// so the completion/telemetry checks are deterministic and never hit a paid provider.
const MOCK_PROVIDER_ID = "mock-cheap";
const MOCK_MODEL_ID = "mock-cheap:small";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--web-url") out.webUrl = next();
    else if (a === "--api-url") out.apiUrl = next();
    else if (a === "--api-key") out.apiKey = next();
    else if (a === "--timeout-ms") out.timeoutMs = Number(next());
    else if (a === "--warmup-retries") out.warmupRetries = Number(next());
    else if (a === "--providers") out.providers = next();
    else if (a === "--help" || a === "-h") out.help = true;
    else {
      console.error(`unknown argument: ${a}`);
      out.help = true;
    }
  }
  return out;
}

function printHelp() {
  console.log(
    [
      "LLM Cost Autopilot — deployment smoke test",
      "",
      "Usage:",
      "  node scripts/smoke-deployment.mjs --web-url <url> --api-url <url> --api-key <key>",
      "",
      "Options (env var fallback in parentheses):",
      "  --web-url          frontend base URL            (LCA_SMOKE_WEB_URL)",
      "  --api-url          API base URL                 (LCA_SMOKE_API_URL)",
      "  --api-key          demo bearer key              (LCA_SMOKE_API_KEY)",
      "  --timeout-ms       per-request timeout          (LCA_SMOKE_TIMEOUT_MS, default 30000)",
      "  --warmup-retries   cold-start retries per req   (LCA_SMOKE_WARMUP_RETRIES, default 5)",
      "  --providers        optional paid providers,     (LCA_SMOKE_PROVIDERS)",
      "                     comma separated, e.g. gemini,groq",
      "  --help             show this help",
    ].join("\n"),
  );
}

function trimTrailingSlash(u) {
  return u.endsWith("/") ? u.slice(0, -1) : u;
}

/** Build a redactor that masks the supplied secret plus common secret shapes. */
function makeRedactor(secret) {
  const patterns = [
    /Bearer\s+[A-Za-z0-9._\-+/=]+/gi,
    /sk-[A-Za-z0-9._\-]+/gi,
    /\bapi[_-]?key\b\s*[=:]\s*["']?[A-Za-z0-9._\-]+/gi,
    /"secret"\s*:\s*"[^"]*"/gi,
  ];
  return function redact(input) {
    let s = typeof input === "string" ? input : String(input ?? "");
    if (secret && secret.length >= 4) {
      s = s.split(secret).join("[REDACTED]");
    }
    for (const re of patterns) s = s.replace(re, "[REDACTED]");
    return s;
  };
}

async function requestOnce(method, url, { headers = {}, body, timeoutMs }) {
  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    return { status: res.status, text, headers: res.headers };
  } catch (err) {
    const reason = err?.name === "TimeoutError" ? `timeout after ${timeoutMs}ms` : (err?.message ?? String(err));
    return { status: 0, text: "", error: reason };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry transient transport failures and gateway statuses (0/502/503/504) that
 * a sleeping Render service produces while cold-starting. Never retries a real
 * HTTP response in the 2xx/4xx range.
 */
async function requestWithRetry(method, url, opts, retries) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    last = await requestOnce(method, url, opts);
    const transient = last.status === 0 || last.status === 502 || last.status === 503 || last.status === 504;
    if (!transient) return last;
    if (attempt < retries) await sleep(Math.min(1000 * 2 ** attempt, 8000));
  }
  return last;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const webUrl = trimTrailingSlash(args.webUrl ?? process.env.LCA_SMOKE_WEB_URL ?? "");
  const apiUrl = trimTrailingSlash(args.apiUrl ?? process.env.LCA_SMOKE_API_URL ?? "");
  const apiKey = args.apiKey ?? process.env.LCA_SMOKE_API_KEY ?? "";
  const timeoutMs = Number(args.timeoutMs ?? process.env.LCA_SMOKE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const warmupRetries = Number(args.warmupRetries ?? process.env.LCA_SMOKE_WARMUP_RETRIES ?? DEFAULT_WARMUP_RETRIES);
  const providers = (args.providers ?? process.env.LCA_SMOKE_PROVIDERS ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  const missing = [];
  if (!webUrl) missing.push("--web-url / LCA_SMOKE_WEB_URL");
  if (!apiUrl) missing.push("--api-url / LCA_SMOKE_API_URL");
  if (!apiKey) missing.push("--api-key / LCA_SMOKE_API_KEY");
  if (missing.length > 0) {
    console.error(`missing required configuration: ${missing.join(", ")}`);
    console.error("run with --help for usage.");
    process.exit(2);
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    console.error("--timeout-ms must be a positive number");
    process.exit(2);
  }

  const redact = makeRedactor(apiKey);
  const authHeaders = { authorization: `Bearer ${apiKey}` };

  console.log("LLM Cost Autopilot — deployment smoke test");
  console.log(`  web: ${webUrl}`);
  console.log(`  api: ${apiUrl}`);
  console.log(`  timeout: ${timeoutMs}ms   cold-start retries: ${warmupRetries}`);
  if (providers.length > 0) console.log(`  optional providers: ${providers.join(", ")}`);
  console.log("");

  const results = [];
  function record(name, required, ok, status, detail) {
    results.push({ name, required, ok, status, detail });
    const tag = ok ? "PASS" : required ? "FAIL" : "WARN";
    const idx = String(results.length).padStart(2, " ");
    const statusStr = status === 0 ? "   -" : String(status).padStart(4, " ");
    let line = `[${idx}] ${tag}  ${name.padEnd(42)} ${statusStr}`;
    if (!ok && detail) line += `\n        ${redact(detail).slice(0, 300)}`;
    console.log(line);
  }

  // 1. Frontend /overview
  {
    const r = await requestWithRetry("GET", `${webUrl}/overview`, { timeoutMs }, warmupRetries);
    record("frontend GET /overview", true, r.status === 200, r.status, r.error ?? r.text);
  }

  // 2. Frontend /cost
  {
    const r = await requestWithRetry("GET", `${webUrl}/cost`, { timeoutMs }, warmupRetries);
    record("frontend GET /cost", true, r.status === 200, r.status, r.error ?? r.text);
  }

  // 3. API health (public): 200 + status ok
  {
    const r = await requestWithRetry("GET", `${apiUrl}/v1/health`, { timeoutMs }, warmupRetries);
    let ok = r.status === 200;
    if (ok) {
      try {
        ok = JSON.parse(r.text)?.status === "ok";
      } catch {
        ok = false;
      }
    }
    record("API GET /v1/health (status ok)", true, ok, r.status, r.error ?? r.text);
  }

  // 4. Unauthenticated protected request is rejected with 401
  {
    const r = await requestWithRetry("GET", `${apiUrl}/v1/telemetry/summary`, { timeoutMs }, warmupRetries);
    record("API unauthenticated request rejected", true, r.status === 401, r.status, r.error ?? r.text);
  }

  // 5. Authenticated safe read: GET /v1/keys (list metadata — never creates/deletes)
  {
    const r = await requestWithRetry("GET", `${apiUrl}/v1/keys`, { headers: authHeaders, timeoutMs }, warmupRetries);
    let ok = r.status === 200;
    if (ok) {
      try {
        ok = Array.isArray(JSON.parse(r.text));
      } catch {
        ok = false;
      }
    }
    record("API authenticated GET /v1/keys", true, ok, r.status, r.error ?? r.text);
  }

  // 6. Provider/catalog availability: GET /v1/catalog (also drives optional provider checks)
  let catalogModels = [];
  {
    const r = await requestWithRetry("GET", `${apiUrl}/v1/catalog`, { headers: authHeaders, timeoutMs }, warmupRetries);
    let ok = r.status === 200;
    if (ok) {
      try {
        const body = JSON.parse(r.text);
        catalogModels = Array.isArray(body?.models) ? body.models : [];
        ok = catalogModels.length > 0;
      } catch {
        ok = false;
      }
    }
    record("API catalog availability", true, ok, r.status, r.error ?? r.text);
  }

  // 7. Deterministic Mock completion (pinned via override; never a paid provider)
  const completionEventId = randomUUID();
  {
    const body = JSON.stringify({
      messages: [{ role: "user", content: "deployment smoke test" }],
      requirements: { requiredCapabilities: [] },
      override: { providerId: MOCK_PROVIDER_ID, modelId: MOCK_MODEL_ID },
    });
    const r = await requestWithRetry(
      "POST",
      `${apiUrl}/v1/completions`,
      {
        headers: { ...authHeaders, "content-type": "application/json", "x-request-id": completionEventId },
        body,
        timeoutMs,
      },
      warmupRetries,
    );
    let ok = r.status === 200;
    if (ok) {
      try {
        const d = JSON.parse(r.text)?.decision;
        ok = d?.chosenProviderId === MOCK_PROVIDER_ID && d?.chosenModelId === MOCK_MODEL_ID;
      } catch {
        ok = false;
      }
    }
    record("API deterministic mock completion", true, ok, r.status, r.error ?? r.text);
  }

  // 8. Telemetry recorded: the completion's event becomes replayable once flushed.
  {
    const deadline = Date.now() + timeoutMs;
    let status = 0;
    let ok = false;
    let detail = "event never became replayable";
    while (Date.now() < deadline) {
      const r = await requestOnce("GET", `${apiUrl}/v1/telemetry/replay/${completionEventId}`, {
        headers: authHeaders,
        timeoutMs,
      });
      status = r.status;
      if (r.status === 200) {
        ok = true;
        break;
      }
      if (r.status !== 404 && r.status !== 0) {
        detail = r.error ?? r.text;
        break;
      }
      await sleep(500);
    }
    record("API telemetry recorded (replay)", true, ok, status, detail);
  }

  // 9. Cost/telemetry summary reachable
  {
    const r = await requestWithRetry("GET", `${apiUrl}/v1/telemetry/summary`, { headers: authHeaders, timeoutMs }, warmupRetries);
    record("API telemetry summary reachable", true, r.status === 200, r.status, r.error ?? r.text);
  }

  // 10. Provider health endpoint reachable
  {
    const r = await requestWithRetry("GET", `${apiUrl}/v1/health/providers`, { headers: authHeaders, timeoutMs }, warmupRetries);
    let ok = r.status === 200;
    if (ok) {
      try {
        ok = Array.isArray(JSON.parse(r.text));
      } catch {
        ok = false;
      }
    }
    record("API provider health reachable", true, ok, r.status, r.error ?? r.text);
  }

  // 11. Prometheus metrics endpoint (public)
  {
    const r = await requestWithRetry("GET", `${apiUrl}/metrics`, { timeoutMs }, warmupRetries);
    const ok = r.status === 200 && /# (HELP|TYPE) /.test(r.text);
    record("API metrics endpoint reachable", true, ok, r.status, r.error ?? r.text);
  }

  // Optional: paid-provider completions, only when explicitly requested.
  for (const provider of providers) {
    const model = catalogModels.find((m) => m?.providerId === provider);
    if (!model) {
      record(`provider ${provider} completion (optional)`, true, false, 0, `no catalog model for provider '${provider}'`);
      continue;
    }
    const body = JSON.stringify({
      messages: [{ role: "user", content: "deployment smoke test" }],
      requirements: { requiredCapabilities: [] },
      override: { providerId: provider, modelId: model.modelId },
    });
    const r = await requestWithRetry(
      "POST",
      `${apiUrl}/v1/completions`,
      { headers: { ...authHeaders, "content-type": "application/json" }, body, timeoutMs },
      warmupRetries,
    );
    let ok = r.status === 200;
    if (ok) {
      try {
        ok = JSON.parse(r.text)?.decision?.chosenProviderId === provider;
      } catch {
        ok = false;
      }
    }
    // Requested explicitly by the operator, so a failure fails the run.
    record(`provider ${provider} completion (requested)`, true, ok, r.status, r.error ?? r.text);
  }

  const required = results.filter((r) => r.required);
  const passed = required.filter((r) => r.ok).length;
  const failed = required.length - passed;
  console.log("");
  console.log(`Result: ${passed}/${required.length} checks passed — ${failed === 0 ? "PASS" : "FAIL"}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`smoke test crashed: ${err?.message ?? err}`);
  process.exit(1);
});
