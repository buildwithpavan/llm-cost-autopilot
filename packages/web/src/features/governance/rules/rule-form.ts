import type { Capability, OperatorRule, OperatorRuleInput } from "../../../types/index.js";

/** The four known capabilities, in a stable display order. */
export const CAPABILITIES: readonly Capability[] = [
  "tool_use",
  "json_mode",
  "function_calling",
  "vision",
];

/** Raw, string-backed form state (inputs stay as text until submit). */
export interface RuleFormState {
  priority: string;
  enabled: boolean;
  clientIds: string[];
  capabilities: Capability[];
  minTokens: string;
  maxTokens: string;
  providerId: string;
  modelId: string;
}

export interface RuleFormErrors {
  priority?: string;
  minTokens?: string;
  maxTokens?: string;
  tokenRange?: string;
  pin?: string;
}

export function emptyForm(): RuleFormState {
  return {
    priority: "0",
    enabled: true,
    clientIds: [],
    capabilities: [],
    minTokens: "",
    maxTokens: "",
    providerId: "",
    modelId: "",
  };
}

/** Seeds the form from an existing rule, preserving null vs empty distinctions. */
export function formFromRule(rule: OperatorRule): RuleFormState {
  return {
    priority: String(rule.priority),
    enabled: rule.enabled,
    clientIds: rule.match.clientIds ?? [],
    capabilities: rule.match.requiredCapabilities ?? [],
    minTokens: rule.match.minEstimatedTokens === null ? "" : String(rule.match.minEstimatedTokens),
    maxTokens: rule.match.maxEstimatedTokens === null ? "" : String(rule.match.maxEstimatedTokens),
    providerId: rule.pin.providerId ?? "",
    modelId: rule.pin.modelId ?? "",
  };
}

function parseIntStrict(raw: string): number | null {
  const t = raw.trim();
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

/** Trimmed, non-empty client IDs; used both for validation and payload. */
export function normalizeClientIds(ids: string[]): string[] {
  return ids.map((s) => s.trim()).filter((s) => s.length > 0);
}

export function toggleCapability(list: Capability[], cap: Capability): Capability[] {
  return list.includes(cap) ? list.filter((c) => c !== cap) : [...list, cap];
}

/** Client-side UX validation only — never routing/precedence/overlap logic. */
export function validateForm(state: RuleFormState): RuleFormErrors {
  const errors: RuleFormErrors = {};

  if (parseIntStrict(state.priority) === null) {
    errors.priority = "Priority must be an integer.";
  }

  const minRaw = state.minTokens.trim();
  const maxRaw = state.maxTokens.trim();
  const min = minRaw === "" ? null : parseIntStrict(minRaw);
  const max = maxRaw === "" ? null : parseIntStrict(maxRaw);

  if (minRaw !== "" && (min === null || min < 0)) {
    errors.minTokens = "Minimum must be a non-negative integer.";
  }
  if (maxRaw !== "" && (max === null || max < 0)) {
    errors.maxTokens = "Maximum must be a non-negative integer.";
  }
  if (min !== null && min >= 0 && max !== null && max >= 0 && min > max) {
    errors.tokenRange = "Minimum cannot exceed maximum.";
  }

  if (state.providerId.trim() === "" && state.modelId.trim() === "") {
    errors.pin = "Provide a provider ID, a model ID, or both.";
  }

  return errors;
}

export function hasErrors(errors: RuleFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Builds the backend payload from validated form state.
 * Empty client-ID and capability lists collapse to null ("Any") to match the
 * backend match semantics; empty token/pin fields become null.
 */
export function buildPayload(state: RuleFormState): OperatorRuleInput {
  const clientIds = normalizeClientIds(state.clientIds);
  const minRaw = state.minTokens.trim();
  const maxRaw = state.maxTokens.trim();
  const providerId = state.providerId.trim();
  const modelId = state.modelId.trim();

  return {
    priority: Number(state.priority.trim()),
    enabled: state.enabled,
    match: {
      clientIds: clientIds.length > 0 ? clientIds : null,
      requiredCapabilities: state.capabilities.length > 0 ? [...state.capabilities] : null,
      minEstimatedTokens: minRaw === "" ? null : Number(minRaw),
      maxEstimatedTokens: maxRaw === "" ? null : Number(maxRaw),
    },
    pin: {
      providerId: providerId === "" ? null : providerId,
      modelId: modelId === "" ? null : modelId,
    },
  };
}
