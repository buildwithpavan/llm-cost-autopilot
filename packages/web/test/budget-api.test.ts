import { afterEach, describe, expect, it, vi } from "vitest";

import { getBudgetStatus, type BudgetStatusResponse } from "../src/lib/api/budgets";

const payload: BudgetStatusResponse = {
  budgets: [
    {
      budgetId: "budget_1",
      scope: "client",
      clientId: "acme",
      period: "daily",
      action: "block",
      limitUsd: "10.000000",
      currentSpendUsd: "2.500000",
      remainingUsd: "7.500000",
      utilization: "0.250000",
      status: "below_limit",
    },
  ],
};

describe("getBudgetStatus wrapper", () => {
  afterEach(() => vi.restoreAllMocks());

  function mockFetch(body: BudgetStatusResponse) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
    );
  }

  it("requests GET /v1/budgets/status with no query params and sends the bearer key", async () => {
    const spy = mockFetch(payload);
    const res = await getBudgetStatus({ apiKey: "secret-key" });
    const [url, init] = spy.mock.calls[0]!;
    const u = String(url);
    expect(u).toContain("/v1/budgets/status");
    // Budget window is backend-defined → never send since/until/clientId/provider/model.
    expect(u).not.toContain("?");
    expect(u).not.toMatch(/since|until|clientId|providerId|modelId/);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer secret-key");
    expect(res).toEqual(payload);
  });

  it("maps the response rows verbatim (decimal strings preserved)", async () => {
    mockFetch(payload);
    const res = await getBudgetStatus();
    expect(res.budgets[0]!.utilization).toBe("0.250000");
    expect(res.budgets[0]!.currentSpendUsd).toBe("2.500000");
    expect(typeof res.budgets[0]!.limitUsd).toBe("string");
  });
});
