import type { FastifyPluginAsync, FastifyReply } from "fastify";

import type { TelemetryStreamEvent } from "@lca/core";

import type { AppContext } from "../wiring.js";
import { sharedStreamBus, type TelemetryStreamBus } from "../plugins/stream-bus.js";

export interface StreamDeps extends AppContext {
  streamBus?: TelemetryStreamBus;
  heartbeatIntervalMs?: number;
}

/**
 * Server-Sent Events endpoint that mirrors the in-process TelemetryStreamBus
 * to any authenticated observer. Each message is:
 *
 *     data: {"seq":N,"eventType":"...","eventId":"...", ...}\n\n
 *
 * A periodic heartbeat prevents proxies from closing idle connections.
 * Optional client filters:  ?clientId=<id>   → only emit events for that client
 */
const plugin: FastifyPluginAsync<StreamDeps> = async (fastify, deps) => {
  const bus = deps.streamBus ?? sharedStreamBus;
  const heartbeatMs = deps.heartbeatIntervalMs ?? 15_000;

  fastify.get("/v1/telemetry/events/stream", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const filterClientId = q["clientId"] ?? null;

    const raw = reply.raw;
    raw.setHeader("content-type", "text/event-stream");
    raw.setHeader("cache-control", "no-cache, no-transform");
    raw.setHeader("connection", "keep-alive");
    raw.setHeader("x-accel-buffering", "no");
    // Mirror the reply-level CORS headers onto the raw response so browsers
    // don't reject the streamed body after the hijack.
    const origin = req.headers.origin;
    if (typeof origin === "string") {
      raw.setHeader("access-control-allow-origin", origin);
      raw.setHeader("access-control-allow-credentials", "true");
    }
    // Flush headers immediately so the client sees the open connection.
    raw.flushHeaders?.();

    const write = (event: TelemetryStreamEvent): void => {
      try {
        raw.write(`event: ${event.eventType}\n`);
        raw.write(`id: ${event.seq}\n`);
        raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        /* client closed; unsubscribe below will handle cleanup */
      }
    };

    const hello: TelemetryStreamEvent = {
      seq: 0,
      eventType: "stream.hello",
      eventId: "",
      clientId: (req as unknown as { lca?: { clientId: string } }).lca?.clientId ?? "unknown",
      timestamp: new Date().toISOString(),
    };
    write(hello);

    const unsubscribe = bus.subscribe((event) => {
      if (filterClientId && event.clientId !== filterClientId) return;
      write(event);
    });

    const heartbeat = setInterval(() => {
      write({
        seq: 0,
        eventType: "stream.heartbeat",
        eventId: "",
        clientId: hello.clientId,
        timestamp: new Date().toISOString(),
      });
    }, heartbeatMs);

    const close = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
      try {
        raw.end();
      } catch {
        /* already closed */
      }
    };
    req.raw.on("close", close);
    reply.raw.on("close", close);

    // Fastify async handlers must return; hijack the response so the framework
    // doesn't try to send its own body.
    return reply.hijack() as unknown as FastifyReply;
  });
};

export default plugin;
