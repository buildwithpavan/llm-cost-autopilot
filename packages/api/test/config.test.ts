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

