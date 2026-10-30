import type { Capability } from "@/types";
import type { CompletionRequestBody } from "@/lib/api/completions";

/** All string-backed form fields (controlled inputs), mirroring the completion request. */
export interface PlaygroundFormState {
  systemPrompt: string;
  prompt: string;
  minQualityTier: "" | "low" | "standard" | "high";
  maxLatencyMs: string;
  maxCostUsd: string;
  capabilities: Capability[];
  overrideProviderId: string;
  overrideModelId: string;
}

export interface PlaygroundFormErrors {
  prompt?: string;
  maxLatencyMs?: string;
  maxCostUsd?: string;
}

export const CAPABILITIES: Capability[] = [
  "tool_use",
  "json_mode",
  "function_calling",
  "vision",
];

export function emptyPlaygroundForm(): PlaygroundFormState {
  return {
    systemPrompt: "",
    prompt: "",
    minQualityTier: "",
    maxLatencyMs: "",
    maxCostUsd: "",
    capabilities: [],
    overrideProviderId: "",
    overrideModelId: "",
  };
}

export function toggleCapability(list: Capability[], cap: Capability): Capability[] {
  return list.includes(cap) ? list.filter((c) => c !== cap) : [...list, cap];
}

export function validatePlaygroundForm(state: PlaygroundFormState): PlaygroundFormErrors {
  const errors: PlaygroundFormErrors = {};
  if (state.prompt.trim() === "") {
    errors.prompt = "Enter a prompt to send.";
  }
  const lat = state.maxLatencyMs.trim();
  if (lat !== "" && !/^\d+$/.test(lat)) {
    errors.maxLatencyMs = "Max latency must be a whole number of milliseconds.";
  } else if (lat !== "" && Number(lat) <= 0) {
    errors.maxLatencyMs = "Max latency must be greater than zero.";
  }
  const cost = state.maxCostUsd.trim();
  if (cost !== "" && !/^\d+(\.\d+)?$/.test(cost)) {
    errors.maxCostUsd = "Max cost must be a decimal USD amount (e.g. 0.01).";
  }
  return errors;
}

export function hasErrors(errors: PlaygroundFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Build the POST /v1/completions body, including only the fields the user set. */
export function buildCompletionRequest(state: PlaygroundFormState): CompletionRequestBody {
  const messages: CompletionRequestBody["messages"] = [];
  if (state.systemPrompt.trim() !== "") {
    messages.push({ role: "system", content: state.systemPrompt });
  }
  messages.push({ role: "user", content: state.prompt });

  const requirements: NonNullable<CompletionRequestBody["requirements"]> = {};
  if (state.capabilities.length > 0) requirements.requiredCapabilities = state.capabilities;
  if (state.minQualityTier !== "") requirements.minQualityTier = state.minQualityTier;
  if (state.maxLatencyMs.trim() !== "") requirements.maxLatencyMs = Number(state.maxLatencyMs.trim());
  if (state.maxCostUsd.trim() !== "") requirements.maxCostUsd = state.maxCostUsd.trim();

  const body: CompletionRequestBody = { messages };
  if (Object.keys(requirements).length > 0) body.requirements = requirements;

  const providerId = state.overrideProviderId.trim();
  const modelId = state.overrideModelId.trim();
  if (providerId !== "" || modelId !== "") {
    body.override = {};
    if (providerId !== "") body.override.providerId = providerId;
    if (modelId !== "") body.override.modelId = modelId;
  }
  return body;
}
