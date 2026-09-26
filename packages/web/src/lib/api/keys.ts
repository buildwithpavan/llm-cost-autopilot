import type { ApiKeyMetadata } from "../../types/index.js";
import { apiRequest } from "./client.js";

export interface CreateKeyInput {
  clientId: string;
  label: string;
}

/** Shape returned by POST /v1/keys — the plaintext `secret` appears here exactly once. */
export interface CreatedKey {
  keyId: string;
  secret: string;
  clientId: string;
  label: string;
  createdAt: string;
}

export function listApiKeys(opts: { apiKey?: string; signal?: AbortSignal } = {}): Promise<ApiKeyMetadata[]> {
  const reqOpts: { apiKey?: string; signal?: AbortSignal } = {};
  if (opts.apiKey) reqOpts.apiKey = opts.apiKey;
  if (opts.signal) reqOpts.signal = opts.signal;
  return apiRequest<ApiKeyMetadata[]>("/v1/keys", reqOpts);
}

export function createApiKey(input: CreateKeyInput, opts: { apiKey?: string; signal?: AbortSignal } = {}): Promise<CreatedKey> {
  const reqOpts: { method: "POST"; body: CreateKeyInput; apiKey?: string; signal?: AbortSignal } = {
    method: "POST",
    body: input,
  };
  if (opts.apiKey) reqOpts.apiKey = opts.apiKey;
  if (opts.signal) reqOpts.signal = opts.signal;
  return apiRequest<CreatedKey>("/v1/keys", reqOpts);
}

/** Soft revoke (idempotent, 204). Revoked keys remain in listApiKeys with revokedAt set. */
export function revokeApiKey(keyId: string, opts: { apiKey?: string; signal?: AbortSignal } = {}): Promise<void> {
  const reqOpts: { method: "DELETE"; apiKey?: string; signal?: AbortSignal } = { method: "DELETE" };
  if (opts.apiKey) reqOpts.apiKey = opts.apiKey;
  if (opts.signal) reqOpts.signal = opts.signal;
  return apiRequest<void>(`/v1/keys/${encodeURIComponent(keyId)}`, reqOpts);
}
