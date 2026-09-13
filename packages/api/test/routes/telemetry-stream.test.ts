import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { TelemetryStreamBus } from "../../src/plugins/stream-bus.js";
import telemetryStreamRoute from "../../src/routes/telemetry-stream.js";

/**
 * Contract test for the SSE endpoint. Verifies:
 *   1. HTTP 200 with text/event-stream content-type
 *   2. Emits a `stream.hello` frame at connection time
 *   3. Bus-published events are forwarded to subscribers
 */
describe("GET /v1/telemetry/events/stream", () => {
  it("streams a hello then forwards bus-published events", async () => {
    const bus = new TelemetryStreamBus();
    const app = Fastify();
    await app.register(telemetryStreamRoute, {
      db: {} as never,
      registry: {} as never,
      streamBus: bus,
      heartbeatIntervalMs: 60_000,
    });

    // We can't easily use inject() for SSE (no chunk streaming), so start a
    // real server on a random port and read the raw HTTP response.
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    const url = `http://127.0.0.1:${address.port}/v1/telemetry/events/stream`;

    const ctrl = new AbortController();
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const frames: string[] = [];

    async function readOne(): Promise<string> {
      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          return frame;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended");
        buffer += decoder.decode(value, { stream: true });
      }
    }

    // 1) hello
    frames.push(await readOne());
    expect(frames[0]).toContain("event: stream.hello");
    expect(frames[0]).toContain('"eventType":"stream.hello"');

    // 2) publish a request.received on the bus and read the next frame
    bus.publish({
      eventType: "request.received",
      eventId: "aa000000-0000-0000-0000-000000000001",
      clientId: "acme",
      timestamp: new Date().toISOString(),
      estimatedInputTokens: 12,
      requiredCapabilities: [],
    });
    frames.push(await readOne());
    expect(frames[1]).toContain("event: request.received");
    expect(frames[1]).toContain('"eventType":"request.received"');
    expect(frames[1]).toContain('"seq":1');

    ctrl.abort();
    await app.close();
  }, 5_000);
});
