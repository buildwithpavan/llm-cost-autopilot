import { afterEach, describe, expect, it, vi } from "vitest";

import { postRoutingSimulation, type SimulateRoutingBody, type SimulationResponse } from "../src/lib/api/simulate";

const body: SimulateRoutingBody = {
  request: { messages: [{ role: "user", content: "hi" }] },
  proposedRule: {
    priority: 10,
    enabled: true,
    match: { clientIds: null, requiredCapabilities: null, minEstimatedTokens: null, maxEstimatedTokens: null },
    pin: { providerId: "mock-fast", modelId: null },
  },
};

const payload: SimulationResponse = {
  current: {
    decision: { decisionSource: "autopilot", shadowedSource: null, candidateRanking: [], chosenProviderId: "mock-cheap", chosenModelId: "mock-cheap:small", rationale: [], pricingTableVersionId: "pt", estimatedCostUsd: "0.001000" },
    budget: { decision: "allowed", requestEstimatedCostUsd: "0.001000", blockedBudgetIds: [] },
  },
  proposed: {
    decision: { decisionSource: "operator_rule", shadowedSource: null, candidateRanking: [], chosenProviderId: "mock-fast", chosenModelId: "mock-fast:default", rationale: [], pricingTableVersionId: "pt", estimatedCostUsd: "0.004000" },
    budget: { decision: "blocked", requestEstimatedCostUsd: "0.004000", blockedBudgetIds: ["budget_1"] },
  },
  comparison: { decisionChanged: true, providerChanged: true, modelChanged: true, estimatedCostDeltaUsd: "0.003000", budgetOutcomeChanged: true },
  proposal: { simulationRuleId: "__simulation__", matchesRequest: true, effective: true, shadowedByRuleId: null },
};

describe("postRoutingSimulation wrapper", () => {
  afterEach(() => vi.restoreAllMocks());

  function mockFetch(b: SimulationResponse) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } }),
    );
  }

  it("POSTs request + proposedRule to /v1/routing/simulate with the bearer key", async () => {
    const spy = mockFetch(payload);
    await postRoutingSimulation(body, { apiKey: "secret-key" });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toContain("/v1/routing/simulate");
    const ri = init as RequestInit;
    expect(ri.method).toBe("POST");
    const sent = JSON.parse(String(ri.body));
    expect(sent.request.messages[0].content).toBe("hi");
    expect(sent.proposedRule.pin.providerId).toBe("mock-fast");
    const headers = ri.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer secret-key");
  });

  it("forwards the abort signal", async () => {
    const spy = mockFetch(payload);
    const ctrl = new AbortController();
    await postRoutingSimulation(body, { signal: ctrl.signal });
    const init = spy.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBe(ctrl.signal);
  });

  it("preserves monetary + delta values as exact decimal strings (never Number)", async () => {
    mockFetch(payload);
    const res = await postRoutingSimulation(body);
    expect(res.current.decision.estimatedCostUsd).toBe("0.001000");
    expect(res.proposed.decision.estimatedCostUsd).toBe("0.004000");
    expect(res.comparison.estimatedCostDeltaUsd).toBe("0.003000");
    expect(typeof res.comparison.estimatedCostDeltaUsd).toBe("string");
  });
});
