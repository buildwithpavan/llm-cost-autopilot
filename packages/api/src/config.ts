import { z } from "zod";

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().url(),
  LCA_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAME: z.string().default("lca-api"),
  LCA_BOOTSTRAP_ADMIN_KEY: z.string().min(16).optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  LCA_MOCK_FAIL_FIRST: z.string().optional(),
  // Provider reliability (Phase 8). Per-attempt timeout + bounded retry policy.
  // Retries are off by default (0) to preserve reviewed fallback behavior.
  LCA_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().max(600_000).default(30_000),
  LCA_PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(0),
  LCA_PROVIDER_RETRY_BACKOFF_MS: z.coerce.number().int().min(0).max(60_000).default(100),
  LCA_PROVIDER_RETRY_BACKOFF_MAX_MS: z.coerce.number().int().min(0).max(120_000).default(2_000),
  // Phase 14: optional logical-request deadline bounding TOTAL provider-execution
  // wall time across retries + fallback. 0 = disabled (preserves prior behavior).
  LCA_REQUEST_DEADLINE_MS: z.coerce.number().int().min(0).max(1_200_000).default(0),
  // Provider reliability (Phase 9). Process-local circuit breaker / cooldown.
  LCA_CIRCUIT_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  LCA_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().positive().max(100).default(5),
  LCA_CIRCUIT_COOLDOWN_MS: z.coerce.number().int().positive().max(3_600_000).default(30_000),
  // Cost anomaly detection (Phase 12). Deterministic, estimated-cost basis.
  LCA_ANOMALY_MIN_HISTORY: z.coerce.number().int().positive().max(1000).default(6),
  LCA_ANOMALY_REL_THRESHOLD: z.coerce.number().positive().max(100).default(0.5),
  LCA_ANOMALY_CRIT_REL_THRESHOLD: z.coerce.number().positive().max(1000).default(1),
  LCA_ANOMALY_MIN_ABS_USD: z.string().regex(/^\d+(\.\d+)?$/).default("0.010000"),
});

const envSchema = baseEnvSchema.refine(
  (c) => c.LCA_ANOMALY_CRIT_REL_THRESHOLD >= c.LCA_ANOMALY_REL_THRESHOLD,
  {
    message: "LCA_ANOMALY_CRIT_REL_THRESHOLD must be >= LCA_ANOMALY_REL_THRESHOLD",
    path: ["LCA_ANOMALY_CRIT_REL_THRESHOLD"],
  },
);

export type LcaConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LcaConfig {
  return envSchema.parse(env);
}
