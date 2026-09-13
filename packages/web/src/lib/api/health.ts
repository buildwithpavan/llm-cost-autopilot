import { apiRequest } from "./client.js";

export interface HealthResponse {
  status: "ok" | "degraded" | "down";
  version?: string;
  checks: {
    db: { ok: boolean; latencyMs?: number };
    providers: { ok: boolean; total?: number; healthy?: number };
  };
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiRequest<HealthResponse>("/v1/health", signal ? { signal } : {});
}
