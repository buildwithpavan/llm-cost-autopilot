import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createGeminiAdapter } from "../src/gemini/adapter.js";
import { createGroqAdapter } from "../src/groq/adapter.js";

interface SeedEntry {
  providerId: string;
  modelId: string;
  unitInputUsdPerToken: string;
  unitOutputUsdPerToken: string;
}

function loadSeedEntries(): SeedEntry[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const seedPath = path.resolve(here, "../../../db/seeds/pricing/2026-09-08.json");
  const parsed = JSON.parse(readFileSync(seedPath, "utf8")) as { entries: SeedEntry[] };
  return parsed.entries;
}

const DECIMAL = /^\d+(\.\d+)?$/;

describe("gemini/groq catalog + pricing parity", () => {
  const entries = loadSeedEntries();
  const gemini = createGeminiAdapter({ apiKey: "x" });
  const groq = createGroqAdapter({ apiKey: "x" });

  it("exposes a provider-scoped, non-empty model list with pricing descriptors", () => {
    for (const adapter of [gemini, groq]) {
      const models = adapter.listModels();
      expect(models.length).toBeGreaterThan(0);
      for (const m of models) {
        expect(m.providerId).toBe(adapter.providerId);
        expect(m.pricingDescriptorRef).toBe(m.modelId);
        expect(m.capabilities.length).toBeGreaterThan(0);
        expect(m.contextWindow).toBeGreaterThan(0);
      }
    }
  });

  it("prices every listed Gemini/Groq model in the authoritative seed (routable catalog)", () => {
    for (const adapter of [gemini, groq]) {
      for (const m of adapter.listModels()) {
        const entry = entries.find(
          (e) => e.providerId === m.providerId && e.modelId === m.modelId,
        );
        expect(entry, `missing pricing for ${m.modelId}`).toBeDefined();
        // Exact decimal-string money (never a float literal).
        expect(entry!.unitInputUsdPerToken).toMatch(DECIMAL);
        expect(entry!.unitOutputUsdPerToken).toMatch(DECIMAL);
      }
    }
  });

  it("uses clean provider:model identity (single colon, provider prefix)", () => {
    for (const adapter of [gemini, groq]) {
      for (const m of adapter.listModels()) {
        expect(m.modelId.startsWith(`${adapter.providerId}:`)).toBe(true);
        // adapter strips the prefix via split(":")[1]; ensure that yields a real id.
        expect(m.modelId.split(":")[1]).toBeTruthy();
      }
    }
  });
});
