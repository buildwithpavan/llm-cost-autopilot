"use client";

import { useMemo, useState } from "react";

import { AppShell } from "@/components/shell/AppShell";
import { getEnvironment } from "@/lib/env";
import styles from "./Connect.module.css";

export function ConnectView() {
  const env = useMemo(() => getEnvironment(), []);
  const base = env.apiBaseUrl.replace(/\/$/, "");

  const curl = `curl ${base}/v1/completions \\
  -H "Authorization: Bearer $LCA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "messages": [
      { "role": "user", "content": "Summarize cost-aware routing in one line." }
    ],
    "requirements": { "minQualityTier": "standard", "maxLatencyMs": 2000 }
  }'`;

  const responseJson = `{
  "requestId": "…",
  "providerId": "mock-cheap",
  "modelId": "mock-cheap:small",
  "content": "…",
  "usage": { "inputTokens": 12, "outputTokens": 4 },
  "finishReason": "stop",
  "decision": {
    "decisionSource": "autopilot",
    "chosenProviderId": "mock-cheap",
    "chosenModelId": "mock-cheap:small",
    "estimatedCostUsd": "0.000018",
    "candidateRanking": [ /* every model considered, with estimatedCostUsd */ ],
    "rationale": [ /* why this model won */ ]
  }
}`;

  const node = `import OpenAI from "openai"; // any OpenAI-style client works for the shape

const res = await fetch("${base}/v1/completions", {
  method: "POST",
  headers: {
    "Authorization": \`Bearer \${process.env.LCA_API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    messages: [{ role: "user", content: "Hello" }],
    requirements: { minQualityTier: "standard" },
  }),
});
const data = await res.json();
console.log(data.decision.chosenModelId, data.decision.estimatedCostUsd);`;

  return (
    <AppShell
      connection="idle"
      envLabel={env.envLabel}
      healthy
      version={env.appVersion}
      activeKey="Connect"
    >
      <div className={styles.page}>
        <header className={styles.head}>
          <div className={styles.kicker}>Get started</div>
          <h1 className={styles.title}>Connect your app</h1>
          <p className={styles.subtitle}>
            Point your LLM traffic at the LCA endpoint. The router picks the cheapest model that
            still meets your requirements, executes it, and records the cost and savings — which
            you can then see on the Cost dashboard.
          </p>
        </header>

        <ol className={styles.steps}>
          <li className={styles.step}>
            <div className={styles.stepNum}>1</div>
            <div className={styles.stepBody}>
              <h2 className={styles.stepTitle}>Get an API key</h2>
              <p className={styles.stepText}>
                Create a key under <a className={styles.link} href="/governance">Governance → API Keys</a>. Send it as a
                bearer token on every request. Each key maps to a client ID used for budgets and
                telemetry.
              </p>
            </div>
          </li>

          <li className={styles.step}>
            <div className={styles.stepNum}>2</div>
            <div className={styles.stepBody}>
              <h2 className={styles.stepTitle}>Point requests at the LCA endpoint</h2>
              <p className={styles.stepText}>
                Your base URL is:
              </p>
              <CodeBlock label="Endpoint" code={`${base}/v1/completions`} />
              <p className={styles.stepText}>
                Send messages plus optional <code className={styles.inline}>requirements</code>{" "}
                (quality tier, latency ceiling, cost ceiling, capabilities). LCA chooses the model —
                you don’t pin one.
              </p>
            </div>
          </li>

          <li className={styles.step}>
            <div className={styles.stepNum}>3</div>
            <div className={styles.stepBody}>
              <h2 className={styles.stepTitle}>Send your first request</h2>
              <CodeBlock label="cURL" code={curl} />
              <CodeBlock label="Node.js" code={node} />
            </div>
          </li>

          <li className={styles.step}>
            <div className={styles.stepNum}>4</div>
            <div className={styles.stepBody}>
              <h2 className={styles.stepTitle}>Read the routing decision and savings</h2>
              <p className={styles.stepText}>
                Every response carries the full routing <code className={styles.inline}>decision</code>:
                the chosen model, the estimated cost, and every candidate it considered with their
                own estimated cost — so you can see exactly how much cheaper the chosen model was.
              </p>
              <CodeBlock label="Response" code={responseJson} />
            </div>
          </li>

          <li className={styles.step}>
            <div className={styles.stepNum}>5</div>
            <div className={styles.stepBody}>
              <h2 className={styles.stepTitle}>Watch the savings add up</h2>
              <p className={styles.stepText}>
                Try a request live in the <a className={styles.link} href="/playground">Playground</a>, then track
                accumulated spend and savings over time on the{" "}
                <a className={styles.link} href="/cost">Cost dashboard</a>.
              </p>
            </div>
          </li>
        </ol>
      </div>
    </AppShell>
  );
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (e.g. insecure context) — no-op */
    }
  }

  return (
    <div className={styles.code}>
      <div className={styles.codeBar}>
        <span className={styles.codeLabel}>{label}</span>
        <button type="button" className={styles.copy} onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className={styles.pre}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
