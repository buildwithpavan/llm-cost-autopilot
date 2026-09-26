import type { Capability } from "../../types/index.js";
import type { RoutingPreviewRequest } from "../../lib/api/preview.js";

export type QualityTier = "low" | "standard" | "high";

export const CAPABILITIES: readonly Capability[] = [
  "tool_use",
  "json_mode",
  "function_calling",
  "vision",
];

export const QUALITY_TIERS: readonly QualityTier[] = ["low", "standard", "high"];

export interface PreviewFormState {
  prompt: string;
  capabilities: Capability[];
  minQualityTier: "" | QualityTier;
  maxLatencyMs: string;
  maxCostUsd: string;
}

export interface PreviewFormErrors {
  prompt?: string;
  maxLatencyMs?: string;
  maxCostUsd?: string;
}

export function emptyPreviewForm(): PreviewFormState {
  return {
    prompt: "",
    capabilities: [],
    minQualityTier: "",
    maxLatencyMs: "",
    maxCostUsd: "",
  };
}

export function toggleCapability(list: Capability[], cap: Capability): Capability[] {
  return list.includes(cap) ? list.filter((c) => c !== cap) : [...list, cap];
}

/** Client-side UX validation only — routing/scoring stays on the backend. */
export function validatePreviewForm(state: PreviewFormState): PreviewFormErrors {
  const errors: PreviewFormErrors = {};

  if (state.prompt.trim().length === 0) {
    errors.prompt = "Enter a prompt to preview.";
  }

  const lat = state.maxLatencyMs.trim();
  if (lat !== "" && !(/^\d+$/.test(lat) && Number(lat) > 0)) {
    errors.maxLatencyMs = "Max latency must be a positive integer (ms).";
  }

  // Backend accepts decimal strings matching /^\d+(\.\d+)?$/ — validate as a string, never as a float.
  const cost = state.maxCostUsd.trim();
  if (cost !== "" && !/^\d+(\.\d+)?$/.test(cost)) {
    errors.maxCostUsd = "Max cost must be a decimal USD value (e.g. 0.01).";
  }

  return errors;
}

export function hasErrors(errors: PreviewFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Builds the backend request from validated form state. Empty optional fields are
 * omitted (never fabricated). Preview never sends an override — the backend preview
 * path ignores overrides, so exposing one would be misleading.
 */
export function buildPreviewRequest(state: PreviewFormState): RoutingPreviewRequest {
  const request: RoutingPreviewRequest = {
    messages: [{ role: "user", content: state.prompt.trim() }],
  };

  const requirements: NonNullable<RoutingPreviewRequest["requirements"]> = {};
  if (state.capabilities.length > 0) requirements.requiredCapabilities = [...state.capabilities];
  if (state.minQualityTier) requirements.minQualityTier = state.minQualityTier;
  const lat = state.maxLatencyMs.trim();
  if (lat !== "") requirements.maxLatencyMs = Number(lat);
  const cost = state.maxCostUsd.trim();
  if (cost !== "") requirements.maxCostUsd = cost;
  if (Object.keys(requirements).length > 0) request.requirements = requirements;

  return request;
}
