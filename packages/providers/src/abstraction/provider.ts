import type {
  Attempt,
  Model,
  NormalizedRequest,
  PricingTable,
  ProviderHealthState,
} from "@lca/core";

export interface ExecuteInput {
  readonly request: NormalizedRequest;
  readonly modelId: string;
  readonly pricingTable: PricingTable;
  readonly deadlineAt: string;
}

export interface ExecuteResultSuccess {
  readonly kind: "success";
  readonly content: string;
  readonly finishReason: string;
  readonly attempt: Attempt;
}

export interface ExecuteResultFailure {
  readonly kind: "failure";
  readonly attempt: Attempt;
}

export type ExecuteResult = ExecuteResultSuccess | ExecuteResultFailure;

export interface ProviderAdapter {
  readonly providerId: string;
  listModels(): readonly Model[];
  probeHealth(signal: AbortSignal): Promise<ProviderHealthState>;
  execute(input: ExecuteInput, signal: AbortSignal): Promise<ExecuteResult>;
}
