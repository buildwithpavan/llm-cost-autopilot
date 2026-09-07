import { redaction, type TelemetryEvent } from "@lca/core";

import type { Db } from "../db/schema.js";

export interface TelemetryWriterOptions {
  /** Max rows per batch insert. Default 100. */
  readonly batchSize?: number;
  /** Max ms to buffer before flushing. Default 200. */
  readonly flushEveryMs?: number;
}

export interface TelemetryWriter {
  write(event: redaction.RedactedTelemetryEvent): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Batched telemetry writer. Enforces the RedactedTelemetryEvent brand at the
 * boundary (contracts/telemetry.md#redaction-gate).
 */
export function createTelemetryWriter(db: Db, options: TelemetryWriterOptions = {}): TelemetryWriter {
  const batchSize = options.batchSize ?? 100;
  const flushEveryMs = options.flushEveryMs ?? 200;

  let buffer: redaction.RedactedTelemetryEvent[] = [];
  let closed = false;
  let flushTimer: NodeJS.Timeout | undefined;
  let flushing: Promise<void> | undefined;

  async function flushNow(): Promise<void> {
    if (flushing) {
      await flushing;
    }
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    flushing = (async () => {
      const rows = batch.map((ev) => ({
        event_id: ev.eventId,
        received_at: ev.receivedAt,
        client_id: ev.clientId,
        decision_source: ev.decisionSource,
        shadowed_source: ev.shadowedSource,
        effective_provider_id: ev.effectiveProviderId,
        effective_model_id: ev.effectiveModelId,
        attempts: JSON.stringify(ev.attempts),
        aggregated_input_tokens: ev.aggregatedInputTokens,
        aggregated_output_tokens: ev.aggregatedOutputTokens,
        total_latency_ms: ev.totalLatencyMs,
        terminal_error_class: ev.terminalErrorClass,
        estimated_cost_usd: ev.estimatedCostUsd,
        actual_cost_usd: ev.actualCostUsd,
        pricing_table_version_id: ev.pricingTableVersionId,
        reconciled: ev.reconciled,
        routing_rationale: JSON.stringify(ev.routingRationale),
      }));
      await db.insertInto("telemetry_events").values(rows).execute();
    })();
    try {
      await flushing;
    } finally {
      flushing = undefined;
    }
  }

  function scheduleFlush(): void {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      void flushNow().catch(() => {
        /* logged elsewhere; do not throw from timer */
      });
    }, flushEveryMs);
  }

  return {
    async write(event) {
      if (closed) throw new Error("telemetry writer is closed");
      // Brand check — refuses non-redacted input at the boundary.
      redaction.assertRedacted(event);
      buffer.push(event);
      if (buffer.length >= batchSize) {
        await flushNow();
      } else {
        scheduleFlush();
      }
    },
    async flush() {
      await flushNow();
    },
    async close() {
      closed = true;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      await flushNow();
    },
  };
}

/** Convenience for callers that only need to write one event synchronously. */
export async function writeTelemetryImmediate(
  db: Db,
  event: TelemetryEvent,
): Promise<void> {
  const redacted = redaction.applyRedactionToTelemetry(event);
  const writer = createTelemetryWriter(db, { batchSize: 1, flushEveryMs: 0 });
  await writer.write(redacted);
  await writer.close();
}
