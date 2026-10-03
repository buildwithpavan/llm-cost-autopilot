import { describe, expect, it } from "vitest";

import type { SimulationResponse } from "../src/lib/api/simulate";
import { presentSimulation, BUDGET_LABEL, BUDGET_TONE } from "../src/features/preview/simulation-model";
import {
  buildSimulateBody,
  emptySimulationForm,
  validateSimulationForm,
  hasSimulationErrors,
} from "../src/features/preview/simulation-form";

function res(over: Partial<SimulationResponse> = {}): SimulationResponse {
  return {
    current: {
      decision: { decisionSource: "autopilot", shadowedSource: null, candidateRanking: [], chosenProviderId: "mock-cheap", chosenModelId: "mock-cheap:small", rationale: [], pricingTableVersionId: "pt", estimatedCostUsd: "0.001000" },
      budget: { decision: "allowed", requestEstimatedCostUsd: "0.001000", blockedBudgetIds: [] },
    },
    proposed: {
      decision: { decisionSource: "operator_rule", shadowedSource: null, candidateRanking: [], chosenProviderId: "mock-fast", chosenModelId: "mock-fast:default", rationale: [], pricingTableVersionId: "pt", estimatedCostUsd: "0.004000" },
      budget: { decision: "blocked", requestEstimatedCostUsd: "0.004000", blockedBudgetIds: ["b1"] },
    },
    comparison: { decisionChanged: true, providerChanged: true, modelChanged: true, estimatedCostDeltaUsd: "0.003000", budgetOutcomeChanged: true },
    proposal: { simulationRuleId: "__simulation__", matchesRequest: true, effective: true, shadowedByRuleId: null },
    ...over,
  };
}

describe("presentSimulation", () => {
  it("preserves exact decimal strings and formats a signed positive delta", () => {
    const v = presentSimulation(res());
    expect(v.current.estimatedCostUsd).toBe("0.001000");
    expect(v.proposed.estimatedCostUsd).toBe("0.004000");
    expect(v.estimatedCostDeltaUsd).toBe("0.003000");
    expect(v.costDeltaSign).toBe("up");
    expect(v.costDeltaDisplay.startsWith("+")).toBe(true);
    expect(v.current.estimatedDisplay).toContain("$");
  });

  it("formats a negative delta (proposed cheaper) with a down sign", () => {
    const v = presentSimulation(res({ comparison: { decisionChanged: true, providerChanged: true, modelChanged: true, estimatedCostDeltaUsd: "-0.003000", budgetOutcomeChanged: true } }));
    expect(v.costDeltaSign).toBe("down");
    expect(v.costDeltaDisplay.startsWith("−")).toBe(true);
  });

  it("treats a zero delta as no change", () => {
    const v = presentSimulation(res({ comparison: { decisionChanged: false, providerChanged: false, modelChanged: false, estimatedCostDeltaUsd: "0", budgetOutcomeChanged: false } }));
    expect(v.costDeltaSign).toBe("none");
  });

  it("carries change flags and labels budgets with a tone", () => {
    const v = presentSimulation(res());
    expect(v.providerChanged).toBe(true);
    expect(v.budgetOutcomeChanged).toBe(true);
    expect(v.current.budgetLabel).toBe("Allowed");
    expect(v.current.budgetTone).toBe("success");
    expect(v.proposed.budgetLabel).toBe("Blocked");
    expect(v.proposed.budgetTone).toBe("error");
  });

  it("summarizes the proposal: effective, shadowed, and no-match", () => {
    expect(presentSimulation(res()).proposalSummary).toContain("governs");
    const shadowed = presentSimulation(res({ proposal: { simulationRuleId: "__simulation__", matchesRequest: true, effective: false, shadowedByRuleId: "rule_abc" } }));
    expect(shadowed.proposalSummary).toContain("shadowed by rule rule_abc");
    const noMatch = presentSimulation(res({ proposal: { simulationRuleId: "__simulation__", matchesRequest: false, effective: false, shadowedByRuleId: null } }));
    expect(noMatch.proposalSummary).toContain("does not match");
  });

  it("exposes bounded budget label/tone maps", () => {
    expect(BUDGET_LABEL.no_budget).toBe("No budget");
    expect(BUDGET_TONE.warned).toBe("warn");
  });
});

describe("buildSimulateBody", () => {
  it("builds request + proposed rule, omitting empty optionals", () => {
    const form = { ...emptySimulationForm(), prompt: "hello", priority: "5", pinProviderId: "mock-fast" };
    const body = buildSimulateBody(form);
    expect(body.request.messages[0]!.content).toBe("hello");
    expect(body.request.requirements).toBeUndefined();
    expect(body.proposedRule.priority).toBe(5);
    expect(body.proposedRule.pin).toEqual({ providerId: "mock-fast", modelId: null });
    expect(body.proposedRule.match).toEqual({ clientIds: null, requiredCapabilities: null, minEstimatedTokens: null, maxEstimatedTokens: null });
  });

  it("parses client ids, capabilities and token ranges", () => {
    const form = {
      ...emptySimulationForm(),
      prompt: "x", pinModelId: "mock-cheap:small",
      matchClientIds: "acme, globex ,",
      matchCapabilities: ["json_mode" as const],
      minTokens: "10", maxTokens: "500",
      requestCapabilities: ["tool_use" as const],
    };
    const body = buildSimulateBody(form);
    expect(body.proposedRule.match.clientIds).toEqual(["acme", "globex"]);
    expect(body.proposedRule.match.requiredCapabilities).toEqual(["json_mode"]);
    expect(body.proposedRule.match.minEstimatedTokens).toBe(10);
    expect(body.proposedRule.match.maxEstimatedTokens).toBe(500);
    expect(body.request.requirements?.requiredCapabilities).toEqual(["tool_use"]);
  });
});

describe("validateSimulationForm", () => {
  it("requires a prompt, integer priority, and a pin", () => {
    const errors = validateSimulationForm(emptySimulationForm());
    expect(errors.prompt).toBeDefined();
    expect(errors.pin).toBeDefined();
    expect(hasSimulationErrors(errors)).toBe(true);
  });

  it("accepts a valid form", () => {
    const errors = validateSimulationForm({ ...emptySimulationForm(), prompt: "hi", priority: "10", pinProviderId: "mock-fast" });
    expect(hasSimulationErrors(errors)).toBe(false);
  });

  it("rejects non-integer token ranges", () => {
    const errors = validateSimulationForm({ ...emptySimulationForm(), prompt: "hi", pinProviderId: "p", minTokens: "1.5" });
    expect(errors.minTokens).toBeDefined();
  });
});
