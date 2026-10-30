"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getCatalog, type CatalogResponse } from "@/lib/api/catalog";
import { postCompletion, type CompletionResponse } from "@/lib/api/completions";
import { ApiCallError } from "@/lib/api/client";
import { getEnvironment } from "@/lib/env";

import {
  buildCompletionRequest,
  emptyPlaygroundForm,
  hasErrors,
  toggleCapability,
  validatePlaygroundForm,
  type PlaygroundFormErrors,
  type PlaygroundFormState,
} from "./playground-form";
import type { Capability } from "@/types";

export interface PlaygroundRunResult {
  response: CompletionResponse;
  /** Client-measured round-trip latency in milliseconds. */
  roundTripMs: number;
}

export type RunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "success"; result: PlaygroundRunResult }
  | { status: "error"; message: string; requestId?: string };

export function usePlayground() {
  const env = useMemo(() => getEnvironment(), []);

  const [form, setForm] = useState<PlaygroundFormState>(emptyPlaygroundForm);
  const [errors, setErrors] = useState<PlaygroundFormErrors>({});
  const [apiKey, setApiKey] = useState<string>(env.apiKey ?? "");
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const reqOpts: { apiKey?: string; signal: AbortSignal } = { signal: controller.signal };
    if (apiKey) reqOpts.apiKey = apiKey;
    getCatalog(reqOpts)
      .then((data) => setCatalog(data))
      .catch(() => {
        /* catalog is optional context for override dropdowns; ignore failures */
      });
    return () => controller.abort();
    // Only refetch the catalog when the key changes (auth-scoped visibility).
  }, [apiKey]);

  const patch = useCallback((next: Partial<PlaygroundFormState>) => {
    setForm((s) => ({ ...s, ...next }));
  }, []);

  const toggleCap = useCallback((cap: Capability) => {
    setForm((s) => ({ ...s, capabilities: toggleCapability(s.capabilities, cap) }));
  }, []);

  const submit = useCallback(async () => {
    const found = validatePlaygroundForm(form);
    setErrors(found);
    if (hasErrors(found)) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRun({ status: "running" });
    const startedAt = performance.now();
    try {
      const body = buildCompletionRequest(form);
      const reqOpts: { apiKey?: string; signal: AbortSignal } = { signal: controller.signal };
      if (apiKey) reqOpts.apiKey = apiKey;
      const response = await postCompletion(body, reqOpts);
      const roundTripMs = Math.round(performance.now() - startedAt);
      setRun({ status: "success", result: { response, roundTripMs } });
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof ApiCallError) {
        setRun({ status: "error", message: err.message, requestId: err.requestId });
      } else {
        setRun({ status: "error", message: (err as Error).message });
      }
    }
  }, [form, apiKey]);

  const providerOptions = useMemo(() => {
    if (!catalog) return [] as string[];
    return [...new Set(catalog.models.map((m) => m.providerId))].sort();
  }, [catalog]);

  const modelOptions = useMemo(() => {
    if (!catalog) return [] as string[];
    const filtered = form.overrideProviderId
      ? catalog.models.filter((m) => m.providerId === form.overrideProviderId)
      : catalog.models;
    return [...new Set(filtered.map((m) => m.modelId))].sort();
  }, [catalog, form.overrideProviderId]);

  return {
    env,
    form,
    errors,
    apiKey,
    setApiKey,
    run,
    patch,
    toggleCap,
    submit,
    providerOptions,
    modelOptions,
  };
}
