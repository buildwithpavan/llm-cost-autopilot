import {
  aggregateExpiringEvents,
  deleteExpiredEvents,
  deleteExpiredRollups,
} from "./rollup.js";
import type { Db } from "../db/schema.js";

export interface RetentionOptions {
  /** Full-fidelity retention in days. Default 30 (FR-023a). */
  readonly fullFidelityDays?: number;
  /** Rollup retention in days. Default 365 (~12 months). */
  readonly rollupRetentionDays?: number;
  /** How often to run the job in ms. Default 15 minutes. */
  readonly intervalMs?: number;
  /** Injected clock for tests. */
  readonly now?: () => Date;
}

export interface RetentionJob {
  runOnce(): Promise<RetentionRunResult>;
  start(): void;
  stop(): void;
}

export interface RetentionRunResult {
  cutoffIso: string;
  rollupsWritten: number;
  eventsDeleted: number;
  oldRollupsDeleted: number;
}

export function createRetentionJob(db: Db, opts: RetentionOptions = {}): RetentionJob {
  const fullFidelityDays = opts.fullFidelityDays ?? 30;
  const rollupRetentionDays = opts.rollupRetentionDays ?? 365;
  const intervalMs = opts.intervalMs ?? 15 * 60_000;
  const now = opts.now ?? (() => new Date());
  let handle: NodeJS.Timeout | undefined;

  async function runOnce(): Promise<RetentionRunResult> {
    const cutoff = new Date(now().getTime() - fullFidelityDays * 86_400_000);
    const cutoffIso = cutoff.toISOString();
    const rollupCutoff = new Date(now().getTime() - rollupRetentionDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const { rollupsWritten } = await aggregateExpiringEvents(db, cutoffIso);
    const eventsDeleted = await deleteExpiredEvents(db, cutoffIso);
    const oldRollupsDeleted = await deleteExpiredRollups(db, rollupCutoff);
    return { cutoffIso, rollupsWritten, eventsDeleted, oldRollupsDeleted };
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
      // Do not block Node event loop from exiting during tests.
      handle.unref?.();
    },
    stop() {
      if (handle) {
        clearInterval(handle);
        handle = undefined;
      }
    },
  };
}
