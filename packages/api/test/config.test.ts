import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const BASE = {
  DATABASE_URL: "postgres://lca:lca@localhost:5432/lca",
} as NodeJS.ProcessEnv;

describe("provider reliability config (Phase 8)", () => {
  it("applies deterministic safe defaults", () => {
    const c = loadConfig(BASE);
    expect(c.LCA_PROVIDER_TIMEOUT_MS).toBe(30_000);
    expect(c.LCA_PROVIDER_MAX_RETRIES).toBe(0);
    expect(c.LCA_PROVIDER_RETRY_BACKOFF_MS).toBe(100);
    expect(c.LCA_PROVIDER_RETRY_BACKOFF_MAX_MS).toBe(2_000);
  });

  it("accepts valid overrides", () => {
    const c = loadConfig({
      ...BASE,
      LCA_PROVIDER_TIMEOUT_MS: "5000",
      LCA_PROVIDER_MAX_RETRIES: "3",
      LCA_PROVIDER_RETRY_BACKOFF_MS: "50",
      LCA_PROVIDER_RETRY_BACKOFF_MAX_MS: "1000",
    });
    expect(c.LCA_PROVIDER_TIMEOUT_MS).toBe(5000);
    expect(c.LCA_PROVIDER_MAX_RETRIES).toBe(3);
    expect(c.LCA_PROVIDER_RETRY_BACKOFF_MS).toBe(50);
    expect(c.LCA_PROVIDER_RETRY_BACKOFF_MAX_MS).toBe(1000);
  });

  it("rejects a non-positive timeout", () => {
    expect(() => loadConfig({ ...BASE, LCA_PROVIDER_TIMEOUT_MS: "0" })).toThrow();
    expect(() => loadConfig({ ...BASE, LCA_PROVIDER_TIMEOUT_MS: "-1" })).toThrow();
  });

  it("rejects a non-finite or non-integer timeout", () => {
    expect(() => loadConfig({ ...BASE, LCA_PROVIDER_TIMEOUT_MS: "Infinity" })).toThrow();
    expect(() => loadConfig({ ...BASE, LCA_PROVIDER_TIMEOUT_MS: "1.5" })).toThrow();
    expect(() => loadConfig({ ...BASE, LCA_PROVIDER_TIMEOUT_MS: "abc" })).toThrow();
  });

  it("rejects negative retries and enforces an upper bound", () => {
    expect(() => loadConfig({ ...BASE, LCA_PROVIDER_MAX_RETRIES: "-1" })).toThrow();
    expect(() => loadConfig({ ...BASE, LCA_PROVIDER_MAX_RETRIES: "6" })).toThrow();
    expect(() => loadConfig({ ...BASE, LCA_PROVIDER_MAX_RETRIES: "2.5" })).toThrow();
  });

  it("rejects negative backoff", () => {
    expect(() => loadConfig({ ...BASE, LCA_PROVIDER_RETRY_BACKOFF_MS: "-1" })).toThrow();
    expect(() => loadConfig({ ...BASE, LCA_PROVIDER_RETRY_BACKOFF_MAX_MS: "-5" })).toThrow();
  });

  it("allows zero backoff (deterministic, no sleeping)", () => {
    const c = loadConfig({ ...BASE, LCA_PROVIDER_RETRY_BACKOFF_MS: "0" });
    expect(c.LCA_PROVIDER_RETRY_BACKOFF_MS).toBe(0);
  });
});

describe("logical-request deadline config (Phase 14)", () => {
  it("defaults to disabled (0)", () => {
    expect(loadConfig(BASE).LCA_REQUEST_DEADLINE_MS).toBe(0);
  });

  it("accepts a positive override", () => {
    expect(loadConfig({ ...BASE, LCA_REQUEST_DEADLINE_MS: "60000" }).LCA_REQUEST_DEADLINE_MS).toBe(60_000);
  });

  it("rejects negative, non-integer, or over-bound values", () => {
    expect(() => loadConfig({ ...BASE, LCA_REQUEST_DEADLINE_MS: "-1" })).toThrow();
    expect(() => loadConfig({ ...BASE, LCA_REQUEST_DEADLINE_MS: "1.5" })).toThrow();
    expect(() => loadConfig({ ...BASE, LCA_REQUEST_DEADLINE_MS: "abc" })).toThrow();
    expect(() => loadConfig({ ...BASE, LCA_REQUEST_DEADLINE_MS: "1200001" })).toThrow();
  });
});

describe("circuit breaker config (Phase 9)", () => {
  it("applies deterministic safe defaults", () => {
    const c = loadConfig(BASE);
    expect(c.LCA_CIRCUIT_ENABLED).toBe(true);
    expect(c.LCA_CIRCUIT_FAILURE_THRESHOLD).toBe(5);
    expect(c.LCA_CIRCUIT_COOLDOWN_MS).toBe(30_000);
  });

  it("accepts valid overrides and can be disabled", () => {
    const c = loadConfig({
      ...BASE,
      LCA_CIRCUIT_ENABLED: "false",
      LCA_CIRCUIT_FAILURE_THRESHOLD: "2",
      LCA_CIRCUIT_COOLDOWN_MS: "100",
    });
    expect(c.LCA_CIRCUIT_ENABLED).toBe(false);
    expect(c.LCA_CIRCUIT_FAILURE_THRESHOLD).toBe(2);
    expect(c.LCA_CIRCUIT_COOLDOWN_MS).toBe(100);
  });

  it("rejects a non-positive or non-integer threshold", () => {
    expect(() => loadConfig({ ...BASE, LCA_CIRCUIT_FAILURE_THRESHOLD: "0" })).toThrow();
    expect(() => loadConfig({ ...BASE, LCA_CIRCUIT_FAILURE_THRESHOLD: "-1" })).toThrow();
    expect(() => loadConfig({ ...BASE, LCA_CIRCUIT_FAILURE_THRESHOLD: "2.5" })).toThrow();
  });

  it("rejects a non-positive cooldown", () => {
    expect(() => loadConfig({ ...BASE, LCA_CIRCUIT_COOLDOWN_MS: "0" })).toThrow();
    expect(() => loadConfig({ ...BASE, LCA_CIRCUIT_COOLDOWN_MS: "-5" })).toThrow();
  });

  it("rejects an invalid enabled flag", () => {
    expect(() => loadConfig({ ...BASE, LCA_CIRCUIT_ENABLED: "yes" })).toThrow();
  });
});

describe("cost anomaly config (Phase 12)", () => {
  it("applies deterministic safe defaults", () => {
    const c = loadConfig(BASE);
    expect(c.LCA_ANOMALY_MIN_HISTORY).toBe(6);
    expect(c.LCA_ANOMALY_REL_THRESHOLD).toBe(0.5);
    expect(c.LCA_ANOMALY_CRIT_REL_THRESHOLD).toBe(1);
    expect(c.LCA_ANOMALY_MIN_ABS_USD).toBe("0.010000");
  });

  it("accepts valid overrides", () => {
    const c = loadConfig({
      ...BASE,
      LCA_ANOMALY_MIN_HISTORY: "12",
      LCA_ANOMALY_REL_THRESHOLD: "0.75",
      LCA_ANOMALY_CRIT_REL_THRESHOLD: "2",
      LCA_ANOMALY_MIN_ABS_USD: "0.500000",
    });
    expect(c.LCA_ANOMALY_MIN_HISTORY).toBe(12);
    expect(c.LCA_ANOMALY_REL_THRESHOLD).toBe(0.75);
    expect(c.LCA_ANOMALY_CRIT_REL_THRESHOLD).toBe(2);
    expect(c.LCA_ANOMALY_MIN_ABS_USD).toBe("0.500000");
  });

  it("rejects a non-positive or non-integer min history", () => {
    expect(() => loadConfig({ ...BASE, LCA_ANOMALY_MIN_HISTORY: "0" })).toThrow();
    expect(() => loadConfig({ ...BASE, LCA_ANOMALY_MIN_HISTORY: "2.5" })).toThrow();
  });

  it("rejects a non-positive relative threshold", () => {
    expect(() => loadConfig({ ...BASE, LCA_ANOMALY_REL_THRESHOLD: "0" })).toThrow();
    expect(() => loadConfig({ ...BASE, LCA_ANOMALY_REL_THRESHOLD: "-1" })).toThrow();
  });

  it("rejects a non-decimal absolute floor", () => {
    expect(() => loadConfig({ ...BASE, LCA_ANOMALY_MIN_ABS_USD: "abc" })).toThrow();
  });

  it("rejects a critical threshold below the warning threshold", () => {
    expect(() =>
      loadConfig({ ...BASE, LCA_ANOMALY_REL_THRESHOLD: "0.8", LCA_ANOMALY_CRIT_REL_THRESHOLD: "0.5" }),
    ).toThrow();
  });
});

describe("cost optimization insights config (Phase 15)", () => {
  it("applies deterministic advisory defaults", () => {
    const c = loadConfig(BASE);
    expect(c.LCA_OPT_CONCENTRATION_RATIO).toBe("0.40");
    expect(c.LCA_OPT_MIN_SPEND_USD).toBe("0.010000");
    expect(c.LCA_OPT_BUDGET_PRESSURE_RATIO).toBe("0.80");
    expect(c.LCA_OPT_PRICING_MIN_DELTA_USD).toBe("0.010000");
    expect(c.LCA_OPT_MAX_PRICING_ALTERNATIVES).toBe(1);
  });

  it("accepts valid overrides", () => {
    const c = loadConfig({
      ...BASE,
      LCA_OPT_CONCENTRATION_RATIO: "0.65",
      LCA_OPT_MIN_SPEND_USD: "1.000000",
      LCA_OPT_BUDGET_PRESSURE_RATIO: "0.90",
      LCA_OPT_PRICING_MIN_DELTA_USD: "0.050000",
      LCA_OPT_MAX_PRICING_ALTERNATIVES: "3",
    });
    expect(c.LCA_OPT_CONCENTRATION_RATIO).toBe("0.65");
    expect(c.LCA_OPT_MIN_SPEND_USD).toBe("1.000000");
    expect(c.LCA_OPT_BUDGET_PRESSURE_RATIO).toBe("0.90");
    expect(c.LCA_OPT_PRICING_MIN_DELTA_USD).toBe("0.050000");
    expect(c.LCA_OPT_MAX_PRICING_ALTERNATIVES).toBe(3);
  });

  it("rejects non-decimal thresholds and out-of-bound alternative counts", () => {
    expect(() => loadConfig({ ...BASE, LCA_OPT_CONCENTRATION_RATIO: "abc" })).toThrow();
    expect(() => loadConfig({ ...BASE, LCA_OPT_MIN_SPEND_USD: "-0.1" })).toThrow();
    expect(() => loadConfig({ ...BASE, LCA_OPT_MAX_PRICING_ALTERNATIVES: "-1" })).toThrow();
    expect(() => loadConfig({ ...BASE, LCA_OPT_MAX_PRICING_ALTERNATIVES: "11" })).toThrow();
    expect(() => loadConfig({ ...BASE, LCA_OPT_MAX_PRICING_ALTERNATIVES: "1.5" })).toThrow();
  });
});

