import type { ProviderAdapter } from "@lca/providers";

import { setProviderHealth } from "./probe.js";
import type { Db } from "../db/schema.js";

export interface HealthSchedulerOptions {
  /** Poll interval in ms. Default 30 000. */
  readonly intervalMs?: number;
  /** Consecutive failures before flipping to unhealthy. Default 3. */
  readonly unhealthyAfter?: number;
  /** Deadline for each per-provider probe. Default 5 000 ms. */
  readonly probeTimeoutMs?: number;
  /** Injected clock, used by tests. */
  readonly now?: () => Date;
}

export interface HealthScheduler {
  runOnce(): Promise<void>;
  start(): void;
  stop(): void;
}

/**
 * Periodically probes every adapter and reflects the outcome in
 * provider_health_state per data-model.md#provider-health state transitions:
 *   - success → healthy, consecutive_failures = 0
 *   - failure → consecutive_failures += 1; if ≥ unhealthyAfter → unhealthy
 */
export function createHealthScheduler(
  db: Db,
  getAdapters: () => readonly ProviderAdapter[],
  opts: HealthSchedulerOptions = {},
): HealthScheduler {
  const intervalMs = opts.intervalMs ?? 30_000;
  const unhealthyAfter = opts.unhealthyAfter ?? 3;
  const probeTimeoutMs = opts.probeTimeoutMs ?? 5_000;
  const consecutiveFailures = new Map<string, number>();
  let handle: NodeJS.Timeout | undefined;

  async function probeOne(adapter: ProviderAdapter): Promise<void> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), probeTimeoutMs);
    try {
      const state = await adapter.probeHealth(controller.signal);
      if (state.healthy) {
        consecutiveFailures.set(adapter.providerId, 0);
        await setProviderHealth(db, adapter.providerId, true, 0);
      } else {
        const next = (consecutiveFailures.get(adapter.providerId) ?? 0) + 1;
        consecutiveFailures.set(adapter.providerId, next);
        const healthy = next < unhealthyAfter;
        await setProviderHealth(db, adapter.providerId, healthy, next);
      }
    } catch {
      const next = (consecutiveFailures.get(adapter.providerId) ?? 0) + 1;
      consecutiveFailures.set(adapter.providerId, next);
      const healthy = next < unhealthyAfter;
      await setProviderHealth(db, adapter.providerId, healthy, next);
    } finally {
      clearTimeout(t);
    }
  }

  async function runOnce(): Promise<void> {
    const adapters = getAdapters();
    await Promise.all(adapters.map((a) => probeOne(a)));
  }

  return {
    runOnce,
    start() {
      if (handle) return;
      handle = setInterval(() => {
        void runOnce().catch(() => {
          /* logged elsewhere */
        });
      }, intervalMs);
      handle.unref?.();
      void runOnce().catch(() => {});
    },
    stop() {
      if (handle) {
        clearInterval(handle);
        handle = undefined;
      }
    },
  };
}
