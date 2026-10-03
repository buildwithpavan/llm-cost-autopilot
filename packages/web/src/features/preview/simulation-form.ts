import type { Capability, OperatorRuleInput } from "../../types/index.js";
import type { RoutingPreviewRequest } from "../../lib/api/preview.js";
import type { SimulateRoutingBody } from "../../lib/api/simulate.js";

export interface SimulationFormState {
  prompt: string;
  requestCapabilities: Capability[];
  priority: string;
  enabled: boolean;
  pinProviderId: string;
  pinModelId: string;
  matchClientIds: string;
  matchCapabilities: Capability[];
  minTokens: string;
  maxTokens: string;
}

export interface SimulationFormErrors {
  prompt?: string;
  priority?: string;
  pin?: string;
  minTokens?: string;
  maxTokens?: string;
}

export function emptySimulationForm(): SimulationFormState {
  return {
    prompt: "",
    requestCapabilities: [],
    priority: "10",
    enabled: true,
    pinProviderId: "",
    pinModelId: "",
    matchClientIds: "",
    matchCapabilities: [],
    minTokens: "",
    maxTokens: "",
  };
}

function isInt(s: string): boolean {
  return /^\d+$/.test(s.trim());
}

export function validateSimulationForm(state: SimulationFormState): SimulationFormErrors {
  const errors: SimulationFormErrors = {};
  if (state.prompt.trim().length === 0) errors.prompt = "Enter a representative prompt.";
  if (!/^-?\d+$/.test(state.priority.trim())) errors.priority = "Priority must be an integer.";
  if (state.pinProviderId.trim() === "" && state.pinModelId.trim() === "") {
    errors.pin = "Pin a provider and/or model for the proposed rule.";
  }
  if (state.minTokens.trim() !== "" && !isInt(state.minTokens)) errors.minTokens = "Must be a non-negative integer.";
  if (state.maxTokens.trim() !== "" && !isInt(state.maxTokens)) errors.maxTokens = "Must be a non-negative integer.";
  return errors;
}

export function hasSimulationErrors(errors: SimulationFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

function parseClientIds(raw: string): string[] | null {
  const ids = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  return ids.length > 0 ? ids : null;
}

/** Builds the backend simulate body from validated form state (omits empty optionals). */
export function buildSimulateBody(state: SimulationFormState): SimulateRoutingBody {
  const request: RoutingPreviewRequest = { messages: [{ role: "user", content: state.prompt.trim() }] };
  if (state.requestCapabilities.length > 0) {
    request.requirements = { requiredCapabilities: [...state.requestCapabilities] };
  }

  const proposedRule: OperatorRuleInput = {
    priority: Number(state.priority.trim()),
    enabled: state.enabled,
    match: {
      clientIds: parseClientIds(state.matchClientIds),
      requiredCapabilities: state.matchCapabilities.length > 0 ? [...state.matchCapabilities] : null,
      minEstimatedTokens: state.minTokens.trim() !== "" ? Number(state.minTokens.trim()) : null,
      maxEstimatedTokens: state.maxTokens.trim() !== "" ? Number(state.maxTokens.trim()) : null,
    },
    pin: {
      providerId: state.pinProviderId.trim() !== "" ? state.pinProviderId.trim() : null,
      modelId: state.pinModelId.trim() !== "" ? state.pinModelId.trim() : null,
    },
  };

  return { request, proposedRule };
}

export function toggleFormCapability(list: Capability[], cap: Capability): Capability[] {
  return list.includes(cap) ? list.filter((c) => c !== cap) : [...list, cap];
}
