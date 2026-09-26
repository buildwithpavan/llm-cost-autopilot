"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getCatalog, type CatalogResponse } from "../../lib/api/catalog.js";
import { getEnvironment } from "../../lib/env.js";
import type { Async } from "../overview/overview-model.js";

export interface UseCatalogResult {
  catalog: Async<CatalogResponse>;
  refresh: () => void;
}

/** Fetches the catalog — the single primary source for the Models screen. */
export function useCatalog(): UseCatalogResult {
  const env = useMemo(() => getEnvironment(), []);
  const [catalog, setCatalog] = useState<Async<CatalogResponse>>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const reqId = useRef(0);

  useEffect(() => {
    const ctrl = new AbortController();
    const id = ++reqId.current;
    setCatalog({ status: "loading" });
    getCatalog({ ...(env.apiKey ? { apiKey: env.apiKey } : {}), signal: ctrl.signal })
      .then((data) => {
        if (id === reqId.current) setCatalog({ status: "ready", data });
      })
      .catch((err) => {
        if (ctrl.signal.aborted || id !== reqId.current) return;
        setCatalog({ status: "error", message: err instanceof Error ? err.message : "Catalog unavailable" });
      });
    return () => ctrl.abort();
  }, [env, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { catalog, refresh };
}
