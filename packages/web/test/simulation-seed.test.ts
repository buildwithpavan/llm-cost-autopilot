import { describe, expect, it } from "vitest";

import {
  emptySimulationForm,
  simulationSeedFromParams,
} from "../src/features/preview/simulation-form";

describe("simulationSeedFromParams", () => {
  it("extracts the pin prefill from deep-link params", () => {
    const params = new URLSearchParams({ pinProviderId: "mock-cheap", pinModelId: "mock-cheap:small" });
    expect(simulationSeedFromParams(params)).toEqual({
      pinProviderId: "mock-cheap",
      pinModelId: "mock-cheap:small",
    });
  });

  it("omits absent/blank params (no accidental seeding)", () => {
    expect(simulationSeedFromParams(new URLSearchParams())).toEqual({});
    expect(simulationSeedFromParams(new URLSearchParams({ pinProviderId: "  " }))).toEqual({});
  });

  it("seeds only the pin fields and leaves the rest of the form untouched", () => {
    const seeded = emptySimulationForm(
      simulationSeedFromParams(new URLSearchParams({ pinProviderId: "mock-cheap", pinModelId: "mock-cheap:small" })),
    );
    expect(seeded.pinProviderId).toBe("mock-cheap");
    expect(seeded.pinModelId).toBe("mock-cheap:small");
    // Non-pin defaults are unchanged — the deep-link never pre-submits or alters matching.
    expect(seeded.prompt).toBe("");
    expect(seeded.priority).toBe("10");
    expect(seeded.enabled).toBe(true);
    expect(seeded.matchClientIds).toBe("");
  });
});
