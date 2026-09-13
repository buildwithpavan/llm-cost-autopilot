/**
 * Frontend SSE consumer using fetch + ReadableStream (supports arbitrary
 * headers, unlike native EventSource). Isolates all reconnect and parsing
 * concerns behind a small state machine.
 */

import type { TelemetryStreamEvent } from "@lca/core";

export type StreamConnectionState =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "disconnected"
  | "error";

export interface StreamHandle {
  close(): void;
}

export interface OpenStreamOptions {
  url: string;
  apiKey?: string;
  clientId?: string;
  onEvent(event: TelemetryStreamEvent): void;
  onStateChange(state: StreamConnectionState, detail?: string): void;
  /** Max reconnect attempts before giving up (defaults to Infinity). */
  maxReconnectAttempts?: number;
  /** Optional injectable fetch (used by tests). */
  fetchImpl?: typeof fetch;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 15_000;

/**
 * Parse a single SSE frame (blank-line-terminated). Returns null when the
 * frame carries no `data:` payload (e.g. comment-only lines).
 */
export function parseSseFrame(frame: string): { data: string } | null {
  const lines = frame.split(/\r?\n/);
  const dataLines: string[] = [];
  for (const raw of lines) {
    if (!raw || raw.startsWith(":")) continue;
    const idx = raw.indexOf(":");
    const field = idx === -1 ? raw : raw.slice(0, idx);
    const rest = idx === -1 ? "" : raw.slice(idx + 1).replace(/^ /, "");
    if (field === "data") dataLines.push(rest);
  }
  if (dataLines.length === 0) return null;
  return { data: dataLines.join("\n") };
}

/**
 * Read a ReadableStream of Server-Sent Events and invoke onFrame for each
 * completed frame. Handles chunk boundaries that split a frame.
 */
async function pump(
  stream: ReadableStream<Uint8Array>,
  onFrame: (frame: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      if (signal.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        onFrame(frame);
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Open a resilient SSE stream. Returns a handle whose close() cancels reconnection. */
export function openTelemetryStream(opts: OpenStreamOptions): StreamHandle {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let controller = new AbortController();
  let attempts = 0;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async function connectOnce(): Promise<void> {
    if (stopped) return;
    controller = new AbortController();
    opts.onStateChange(attempts === 0 ? "connecting" : "reconnecting");
    try {
      const headers: Record<string, string> = { accept: "text/event-stream" };
      if (opts.apiKey) headers["authorization"] = `Bearer ${opts.apiKey}`;
      const q = new URLSearchParams();
      if (opts.clientId) q.set("clientId", opts.clientId);
      const url = q.toString() ? `${opts.url}?${q.toString()}` : opts.url;
      const res = await fetchImpl(url, {
        method: "GET",
        headers,
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok || !res.body) {
        throw new Error(`stream open failed with ${res.status}`);
      }
      attempts = 0;
      opts.onStateChange("live");
      await pump(
        res.body,
        (frame) => {
          const parsed = parseSseFrame(frame);
          if (!parsed) return;
          try {
            const event = JSON.parse(parsed.data) as TelemetryStreamEvent;
            opts.onEvent(event);
          } catch {
            /* discard malformed frame */
          }
        },
        controller.signal,
      );
      if (stopped) return;
      opts.onStateChange("disconnected", "server closed");
    } catch (err) {
      if (stopped) return;
      const detail = err instanceof Error ? err.message : "unknown";
      opts.onStateChange("error", detail);
    }

    if (stopped) return;
    if (typeof opts.maxReconnectAttempts === "number" && attempts >= opts.maxReconnectAttempts) {
      opts.onStateChange("disconnected", "max reconnect attempts reached");
      return;
    }
    attempts += 1;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(attempts, 6));
    reconnectTimer = setTimeout(() => void connectOnce(), delay);
  }

  void connectOnce();

  return {
    close() {
      stopped = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      controller.abort();
      opts.onStateChange("disconnected", "closed by client");
    },
  };
}
