"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ApiKeyMetadata } from "../../types/index.js";
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  type CreateKeyInput,
  type CreatedKey,
} from "../../lib/api/keys.js";
import { getEnvironment } from "../../lib/env.js";

export type KeysStatus = "loading" | "ready" | "error";

export interface UseKeysResult {
  status: KeysStatus;
  keys: ApiKeyMetadata[];
  error: string | null;
  refresh: () => void;
  createKey: (input: CreateKeyInput) => Promise<CreatedKey>;
  revokeKey: (keyId: string) => Promise<void>;
}

/** Fetches API-key metadata and exposes create/revoke; mutations do not auto-refresh. */
export function useKeys(): UseKeysResult {
  const env = useMemo(() => getEnvironment(), []);
  const [status, setStatus] = useState<KeysStatus>("loading");
  const [keys, setKeys] = useState<ApiKeyMetadata[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reqId = useRef(0);

  useEffect(() => {
    const ctrl = new AbortController();
    const id = ++reqId.current;
    setStatus("loading");
    setError(null);
    listApiKeys({ ...(env.apiKey ? { apiKey: env.apiKey } : {}), signal: ctrl.signal })
      .then((rows) => {
        if (id === reqId.current) {
          setKeys(rows);
          setStatus("ready");
        }
      })
      .catch((err) => {
        if (ctrl.signal.aborted || id !== reqId.current) return;
        setError(err instanceof Error ? err.message : "Failed to load API keys");
        setStatus("error");
      });
    return () => ctrl.abort();
  }, [env, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const create = useCallback(
    (input: CreateKeyInput) => createApiKey(input, env.apiKey ? { apiKey: env.apiKey } : {}),
    [env],
  );
  const revoke = useCallback(
    (keyId: string) => revokeApiKey(keyId, env.apiKey ? { apiKey: env.apiKey } : {}),
    [env],
  );

  return { status, keys, error, refresh, createKey: create, revokeKey: revoke };
}
