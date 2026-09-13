import { EventEmitter } from "node:events";

import type { TelemetryStreamEvent } from "@lca/core";

/**
 * In-process pub/sub for stage-level telemetry stream events.
 *
 * The API produces events on the request path (completions.ts) and every
 * open SSE subscription receives them. Not a durable queue: subscribers
 * only observe events that occur while they are connected. Missed events
 * can always be reconstructed from GET /v1/telemetry/events.
 */

const TOPIC = "telemetry-stream-event";

// Distributive Omit — preserves discrimination across the union.
type WithoutSeq<T> = T extends unknown ? Omit<T, "seq"> : never;
export type PublishInput = WithoutSeq<TelemetryStreamEvent>;

export class TelemetryStreamBus {
  private readonly emitter = new EventEmitter();
  private seq = 0;

  constructor() {
    // Prevent Node's default 10-listener soft cap from tripping when many
    // SSE clients connect concurrently.
    this.emitter.setMaxListeners(0);
  }

  /**
   * Publish an event to every subscriber. `seq` is assigned monotonically
   * per-process so the frontend can order/deduplicate.
   */
  publish(event: PublishInput): void {
    this.seq += 1;
    const enriched = { ...event, seq: this.seq } as TelemetryStreamEvent;
    this.emitter.emit(TOPIC, enriched);
  }

  /** Register a subscriber. Returns a disposer. */
  subscribe(listener: (event: TelemetryStreamEvent) => void): () => void {
    this.emitter.on(TOPIC, listener);
    return () => this.emitter.off(TOPIC, listener);
  }

  get listenerCount(): number {
    return this.emitter.listenerCount(TOPIC);
  }
}

export const sharedStreamBus = new TelemetryStreamBus();
