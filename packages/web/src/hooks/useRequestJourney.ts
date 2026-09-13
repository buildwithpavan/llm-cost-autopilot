import { useEffect, useRef, useState } from "react";

/**
 * Presentation-only replay of a request's real routing lifecycle.
 *
 * The backend often completes in ~1ms, so a human can never observe the journey
 * live. This hook does NOT invent state — the set of stages, the winner, the
 * fallback/operator-rule shape are all derived from the real completed event by
 * the caller. It simply animates ONE particle stepping through those already-known
 * stages at a perceptible cadence so the routing journey can actually be watched.
 *
 * Each segment is split into a MOVE phase (particle travels, eased) and a DWELL
 * phase (particle holds at the arrived stage) so the viewer can register
 * "the request is now at Governance" before it moves on.
 *
 * Returns a float `t` in [0, segments]: integer part = current segment index,
 * fraction = progress along that segment. Restarts whenever `key` changes.
 * Respects prefers-reduced-motion (jumps straight to the completed state).
 */
export function useRequestJourney(
  key: string | null,
  segments: number,
  stepMs = 640,
): number {
  const [t, setT] = useState<number>(segments);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (key == null || segments <= 0 || reduce) {
      setT(segments);
      return;
    }

    // Fraction of each step spent moving; the remainder is a dwell/emphasis hold.
    const MOVE = 0.6;
    const easeInOut = (x: number) =>
      x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;

    const total = segments * stepMs;
    const start = performance.now();
    let cancelled = false;

    setT(0);
    const tick = (now: number) => {
      if (cancelled) return;
      const elapsed = now - start;
      if (elapsed >= total) {
        setT(segments);
        return;
      }
      const seg = Math.floor(elapsed / stepMs);
      const local = (elapsed % stepMs) / stepMs;
      const prog = local < MOVE ? easeInOut(local / MOVE) : 1;
      setT(Math.min(segments, seg + prog));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [key, segments, stepMs]);

  return t;
}
