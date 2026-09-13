"use client";
import { useState } from "react";
import { getEnvironment } from "../../lib/env.js";
import { correlationId } from "../../lib/correlation.js";

type ScenarioKey = "normal" | "fallback" | "operator_rule";
type Status = "idle" | "sending" | "sent" | "error";

const CLIENT_OVERRIDE_TARGET = { providerId: "mock-fast", modelId: "mock-fast:default" };

/**
 * Dev-only three-mode trigger. Fires REAL POST /v1/completions requests
 * for each of the three Milestone 2.5 scenarios. Only rendered when
 * NEXT_PUBLIC_LCA_DEV_MODE=1.
 *
 * Scenario helpers:
 *   normal        — plain request, autopilot picks the cheapest eligible model
 *   fallback      — arms mock adapter to fail attempt 0 (transient upstream_5xx),
 *                   then fires the request so the router falls back to attempt 1
 *   operator_rule — POSTs an operator rule that pins tool_use requests to
 *                   mock-cheap, then fires a request WITH client_override
 *                   pointing at mock-fast (the rule shadows the override)
 */
export function DevRequestTrigger({ apiKey }: { apiKey?: string }) {
  const env = getEnvironment();
  const [scenario, setScenario] = useState<ScenarioKey | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [detail, setDetail] = useState<string>("");

  if (!env.devMode) return null;

  async function api(
    path: string,
    body: Record<string, unknown> | null,
    method: "GET" | "POST" | "PATCH" | "DELETE" = "POST",
  ): Promise<Response> {
    const url = `${env.apiBaseUrl.replace(/\/$/, "")}${path}`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-request-id": correlationId(),
    };
    if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;
    return fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
    });
  }

  async function ensureOperatorRule(): Promise<{ ruleId: string }> {
    const list = await api("/v1/operator/rules", null, "GET");
    if (list.ok) {
      const rules = (await list.json()) as Array<{
        ruleId: string;
        pin: { providerId: string | null; modelId: string | null };
        match: { requiredCapabilities: string[] | null };
      }>;
      const existing = rules.find(
        (r) =>
          r.pin.providerId === "mock-cheap" &&
          r.pin.modelId === "mock-cheap:small" &&
          Array.isArray(r.match.requiredCapabilities) &&
          r.match.requiredCapabilities.includes("tool_use"),
      );
      if (existing) return { ruleId: existing.ruleId };
    }
    // Rule pins ANY tool_use request to mock-cheap:small. Any incoming request
    // whose requiredCapabilities include tool_use will match; when the client
    // sends override=mock-fast the rule shadows it.
    const res = await api("/v1/operator/rules", {
      priority: 100,
      enabled: true,
      match: { requiredCapabilities: ["tool_use"] },
      pin: { providerId: "mock-cheap", modelId: "mock-cheap:small" },
    });
    if (!res.ok) throw new Error(`rule create HTTP ${res.status}`);
    const created = (await res.json()) as { ruleId: string };
    return { ruleId: created.ruleId };
  }

  async function armMockFailure(): Promise<void> {
    const res = await api("/v1/dev/mock/arm-failure", { errorClass: "upstream_5xx" });
    if (!res.ok) throw new Error(`arm-failure HTTP ${res.status}`);
  }

  async function fire(kind: ScenarioKey): Promise<void> {
    setScenario(kind);
    setStatus("sending");
    setDetail("");
    try {
      if (kind === "fallback") {
        await armMockFailure();
      }
      if (kind === "operator_rule") {
        await ensureOperatorRule();
      }
      const payload: Record<string, unknown> = {
        messages: [
          {
            role: "user",
            content:
              kind === "operator_rule"
                ? "Summarize this conversation and call the escalation tool if needed."
                : "Summarize this customer conversation and return the key actions.",
          },
        ],
        requirements: {
          requiredCapabilities: kind === "operator_rule" ? ["tool_use"] : [],
        },
      };
      if (kind === "operator_rule") {
        payload.override = CLIENT_OVERRIDE_TARGET;
      }
      const res = await api("/v1/completions", payload);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("sent");
      setDetail("watch it flow");
      window.setTimeout(() => {
        setStatus("idle");
        setScenario(null);
        setDetail("");
      }, 4200);
    } catch (err) {
      setStatus("error");
      setDetail(err instanceof Error ? err.message : "unknown");
    }
  }

  const Button = ({
    label,
    kind,
    tone,
  }: {
    label: string;
    kind: ScenarioKey;
    tone: "accent" | "warn" | "info";
  }) => {
    const active = scenario === kind && status !== "idle";
    const border =
      tone === "accent"
        ? "var(--border-accent)"
        : tone === "warn"
          ? "var(--warn)"
          : "var(--accent-cyan)";
    const dot =
      status === "sent" && active
        ? "var(--success)"
        : status === "error" && active
          ? "var(--error)"
          : tone === "accent"
            ? "var(--accent-primary)"
            : tone === "warn"
              ? "var(--warn)"
              : "var(--accent-cyan)";
    return (
      <button
        type="button"
        onClick={() => void fire(kind)}
        disabled={status === "sending"}
        title={label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 30,
          padding: "0 12px",
          borderRadius: "var(--r-tab)",
          border: `1px solid ${border}`,
          background: active ? "var(--bg-tab-active)" : "var(--bg-card)",
          color: "var(--text-primary)",
          fontFamily: "var(--font-sans)",
          fontSize: 11,
          fontWeight: 600,
          cursor: status === "sending" ? "wait" : "pointer",
          opacity: status === "sending" && !active ? 0.55 : 1,
          transition: "background var(--dur-2) var(--ease), opacity var(--dur-2) var(--ease)",
        }}
      >
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: dot }} />
        {active && status === "sending"
          ? "Sending…"
          : active && status === "sent"
            ? `${label} · sent`
            : active && status === "error"
              ? `${label} · error`
              : label}
      </button>
    );
  };

  return (
    <div
      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
      role="group"
      aria-label="Trigger real routing scenarios"
    >
      <Button label="Normal" kind="normal" tone="accent" />
      <Button label="Fallback" kind="fallback" tone="warn" />
      <Button label="Operator rule" kind="operator_rule" tone="info" />
      {status === "error" && detail ? (
        <span
          style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--error)" }}
          role="alert"
        >
          {detail}
        </span>
      ) : null}
    </div>
  );
}
