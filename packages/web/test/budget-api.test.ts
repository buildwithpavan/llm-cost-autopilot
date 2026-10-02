import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getBudgetStatus,
  getBudgetDecisions,
  type BudgetStatusResponse,
  type BudgetDecisionsResponse,
} from "../src/lib/api/budgets";

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

const LONG_CLIENT = "client-".padEnd(80, "x");
const LONG_BUDGET = "budget_".padEnd(80, "y");
const decisionsPayload: BudgetDecisionsResponse = {
  decisions: [
    {
      eventId: "11111111-1111-1111-1111-111111111111",
      decidedAt: "2026-10-02T12:00:00.000Z",
      clientId: LONG_CLIENT,
      decision: "blocked",
      // A value that would lose precision through IEEE-754 if Number()-converted.
      requestEstimatedCostUsd: "12345678901234.567890",
      applicableBudgetIds: [LONG_BUDGET, "budget_b"],
      blockedBudgetIds: [LONG_BUDGET],
      evaluations: [
        { budgetId: LONG_BUDGET, scope: "client", clientId: LONG_CLIENT, period: "daily", action: "block", decision: "block", currentSpendUsd: "1.000000", projectedSpendUsd: "1.001234", limitUsd: "1.000000", remainingUsd: "-0.001234" },
        { budgetId: "budget_b", scope: "global", clientId: null, period: "rolling_30d", action: "warn", decision: "warn", currentSpendUsd: "9.500000", projectedSpendUsd: "9.501234", limitUsd: "9.000000", remainingUsd: "-0.501234" },
      ],
    },
    {
      eventId: "22222222-2222-2222-2222-222222222222",
      decidedAt: "2026-10-02T11:00:00.000Z",
      clientId: "acme",
      decision: "warned",
      requestEstimatedCostUsd: "0.000001",
      applicableBudgetIds: ["budget_c"],
      blockedBudgetIds: [],
      evaluations: [
        { budgetId: "budget_c", scope: "client", clientId: "acme", period: "daily", action: "warn", decision: "warn", currentSpendUsd: "0.499999", projectedSpendUsd: "0.500000", limitUsd: "0.500000", remainingUsd: "0.000000" },
      ],
    },
  ],
};

describe("getBudgetDecisions wrapper", () => {
  afterEach(() => vi.restoreAllMocks());

  function mockFetch(body: BudgetDecisionsResponse) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
    );
  }

  it("passes the selected dashboard window (since/until) and limit, with the bearer key", async () => {
    const spy = mockFetch(decisionsPayload);
    await getBudgetDecisions({
      since: "2026-10-01T12:00:00.000Z",
      until: "2026-10-02T12:00:00.000Z",
      limit: 20,
      apiKey: "secret-key",
    });
    const [url, init] = spy.mock.calls[0]!;
    const u = String(url);
    expect(u).toContain("/v1/telemetry/budget-decisions?");
    expect(u).toContain("since=2026-10-01T12%3A00%3A00.000Z");
    expect(u).toContain("until=2026-10-02T12%3A00%3A00.000Z");
    expect(u).toContain("limit=20");
    // Not keyed on provider/model filters.
    expect(u).not.toMatch(/providerId|modelId/);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer secret-key");
  });

  it("omits clientId when not supplied (operator-facing, no client selector)", async () => {
    const spy = mockFetch(decisionsPayload);
    await getBudgetDecisions({ since: "s", until: "u", limit: 20 });
    expect(String(spy.mock.calls[0]![0])).not.toContain("clientId");
  });

  it("parses the response and preserves decimal strings exactly (no Number() rounding)", async () => {
    mockFetch(decisionsPayload);
    const res = await getBudgetDecisions({ since: "s", until: "u" });
    expect(res.decisions).toHaveLength(2);
    const blocked = res.decisions[0]!;
    expect(blocked.decision).toBe("blocked");
    // Exact string preserved (Number() would mangle this value).
    expect(blocked.requestEstimatedCostUsd).toBe("12345678901234.567890");
    expect(blocked.evaluations).toHaveLength(2);
    expect(blocked.evaluations[0]!.remainingUsd).toBe("-0.001234");
    expect(blocked.evaluations[1]!.limitUsd).toBe("9.000000");
    // Long ids survive untouched.
    expect(blocked.clientId).toBe(LONG_CLIENT);
    expect(blocked.blockedBudgetIds[0]).toBe(LONG_BUDGET);
    expect(res.decisions[1]!.decision).toBe("warned");
    expect(res.decisions[1]!.blockedBudgetIds).toEqual([]);
  });

  it("handles an empty result", async () => {
    mockFetch({ decisions: [] });
    const res = await getBudgetDecisions({ since: "s", until: "u" });
    expect(res.decisions).toEqual([]);
  });
});
