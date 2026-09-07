import type { Message } from "../types/request.js";

/**
 * Cheap heuristic tokeniser used until the tiktoken build lands in tasks.
 * Deterministic: ceil(chars / 4) + 1 per message overhead.
 *
 * This is fine for MVP routing (evaluation only); actual usage counts come
 * from the provider adapter response and drive cost reconciliation (FR-018).
 */
export function estimateInputTokens(messages: readonly Message[]): number {
  if (messages.length === 0) return 0;
  let total = 0;
  for (const m of messages) {
    total += Math.ceil(m.content.length / 4) + 1; // +1 per-message overhead
  }
  return total;
}
