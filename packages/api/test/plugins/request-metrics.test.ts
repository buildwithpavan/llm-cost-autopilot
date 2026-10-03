import { describe, expect, it } from "vitest";

import { outcomeForError, recordCompletionMetrics } from "../../src/plugins/request-metrics.js";
import { LcaError } from "../../src/plugins/errors.js";
import { createMetrics } from "../../src/plugins/metrics.js";

describe("outcomeForError", () => {
  it("maps success (no error)", () => {
    expect(outcomeForError(undefined)).toBe("success");
    expect(outcomeForError(null)).toBe("success");
  });

  it("maps a budget block to budget_blocked", () => {
    expect(outcomeForError(new LcaError({ httpStatus: 429, code: "budget_exceeded", message: "x" }))).toBe("budget_blocked");
  });

  it("maps 4xx LcaErrors to client_error", () => {
    expect(outcomeForError(new LcaError({ httpStatus: 400, code: "invalid_request", message: "x" }))).toBe("client_error");
    expect(outcomeForError(new LcaError({ httpStatus: 422, code: "override_target_missing", message: "x" }))).toBe("client_error");
  });

  it("maps 5xx LcaErrors to provider_error", () => {
    expect(outcomeForError(new LcaError({ httpStatus: 502, code: "terminal_fallback_exhausted", message: "x" }))).toBe("provider_error");
    expect(outcomeForError(new LcaError({ httpStatus: 502, code: "provider_unavailable", message: "x" }))).toBe("provider_error");
  });

  it("maps unexpected (non-LcaError) throws to internal_error", () => {
    expect(outcomeForError(new Error("boom"))).toBe("internal_error");
  });
});

describe("recordCompletionMetrics", () => {
  it("emits exactly one count + one duration, and routing overhead only when finalized", async () => {
    const m = createMetrics();
    const start = process.hrtime.bigint();
    recordCompletionMetrics(m, { error: undefined, startedAt: start, routingOverheadMs: 12.5 });
    recordCompletionMetrics(m, { error: new Error("x"), startedAt: start, routingOverheadMs: null });

    const json = await m.registry.getMetricsAsJSON();
    const req = json.find((x) => x.name === "lca_requests_total")!;
    const counts = Object.fromEntries((req.values as Array<{ labels: { outcome: string }; value: number }>).map((v) => [v.labels.outcome, v.value]));
    expect(counts["success"]).toBe(1);
    expect(counts["internal_error"]).toBe(1);

    const dur = json.find((x) => x.name === "lca_request_duration_seconds")!;
    expect((dur.values.find((v) => v.metricName === "lca_request_duration_seconds_count") as { value: number }).value).toBe(2);

    const overhead = json.find((x) => x.name === "lca_routing_overhead_ms")!;
    // Only the first (finalized) sample produced a routing-overhead observation.
    expect((overhead.values.find((v) => v.metricName === "lca_routing_overhead_ms_count") as { value: number }).value).toBe(1);
  });
});
