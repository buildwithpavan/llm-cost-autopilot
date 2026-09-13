import { describe, expect, it } from "vitest";
import { TelemetryStreamBus } from "../../src/plugins/stream-bus.js";

describe("TelemetryStreamBus", () => {
  it("assigns monotonic seq numbers to every publish", () => {
    const bus = new TelemetryStreamBus();
    const received: number[] = [];
    bus.subscribe((event) => received.push(event.seq));
    bus.publish({
      eventType: "request.received",
      eventId: "e1",
      clientId: "acme",
      timestamp: new Date().toISOString(),
      estimatedInputTokens: 100,
      requiredCapabilities: [],
    });
    bus.publish({
      eventType: "governance.completed",
      eventId: "e1",
      clientId: "acme",
      timestamp: new Date().toISOString(),
      decisionSource: "autopilot",
      shadowedSource: null,
      matchedRuleId: null,
    });
    expect(received).toEqual([1, 2]);
  });

  it("supports unsubscribe", () => {
    const bus = new TelemetryStreamBus();
    let count = 0;
    const off = bus.subscribe(() => (count += 1));
    bus.publish({
      eventType: "stream.heartbeat",
      eventId: "",
      clientId: "acme",
      timestamp: new Date().toISOString(),
    });
    off();
    bus.publish({
      eventType: "stream.heartbeat",
      eventId: "",
      clientId: "acme",
      timestamp: new Date().toISOString(),
    });
    expect(count).toBe(1);
    expect(bus.listenerCount).toBe(0);
  });

  it("delivers events to multiple subscribers", () => {
    const bus = new TelemetryStreamBus();
    const a: number[] = [];
    const b: number[] = [];
    bus.subscribe((e) => a.push(e.seq));
    bus.subscribe((e) => b.push(e.seq));
    bus.publish({
      eventType: "stream.heartbeat",
      eventId: "",
      clientId: "acme",
      timestamp: new Date().toISOString(),
    });
    expect(a).toEqual([1]);
    expect(b).toEqual([1]);
  });
});
