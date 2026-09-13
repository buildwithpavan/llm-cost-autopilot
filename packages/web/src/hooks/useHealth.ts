"use client";
import { useEffect, useState } from "react";
import type { HealthResponse } from "../lib/api/health.js";
import { getHealth } from "../lib/api/health.js";

export type HealthState =
  | { status: "unknown" }
  | { status: "healthy"; response: HealthResponse }
  | { status: "degraded"; response: HealthResponse }
  | { status: "unreachable"; message: string };

const POLL_INTERVAL_MS = 15_000;

export function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ status: "unknown" });

  useEffect(() => {
    let cancelled = false;

    async function tick(): Promise<void> {
      try {
        const res = await getHealth();
        if (cancelled) return;
        const healthy = res.status === "ok" && res.checks.db.ok && res.checks.providers.ok;
        setState({ status: healthy ? "healthy" : "degraded", response: res });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Health check failed";
        setState({ status: "unreachable", message });
      }
    }

    void tick();
    const id = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return state;
}
