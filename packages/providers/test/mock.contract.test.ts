import type { PricingTable } from "@lca/core";

import { providerContractTests } from "../src/contract-tests/index.js";
import { createMockAdapter } from "../src/mock/adapter.js";

const PRICING: PricingTable = {
  versionId: "test-2026-09-08",
  effectiveFrom: "2026-09-08T00:00:00.000Z",
  entries: [
    {
      providerId: "mock-cheap",
      modelId: "mock-cheap:small",
      unitInputUsdPerToken: "0.0000001",
      unitOutputUsdPerToken: "0.0000002",
      currency: "USD",
    },
  ],
};

providerContractTests(
  "mock-cheap",
  () => createMockAdapter({ providerId: "mock-cheap" }),
  {
    modelId: "mock-cheap:small",
    pricingTable: PRICING,
    injectedSecret: "sk-secret-should-not-leak-1234567890",
  },
);
