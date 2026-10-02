import { describe, expect, it } from "vitest";

import { budgetStatus } from "../src/budgets/status.js";

describe("budgetStatus", () => {
  it("reports below_limit with exact remaining and utilization", () => {
    const s = budgetStatus({ limitUsd: "10.000000", currentSpendUsd: "2.500000" });
    expect(s.status).toBe("below_limit");
    expect(s.remainingUsd).toBe("7.500000");
    expect(s.utilization).toBe("0.250000");
  });

  it("reports at_limit when spend equals the limit", () => {
    const s = budgetStatus({ limitUsd: "10.000000", currentSpendUsd: "10.000000" });
    expect(s.status).toBe("at_limit");
    expect(s.remainingUsd).toBe("0.000000");
    expect(s.utilization).toBe("1.000000");
  });

  it("reports over_limit with negative remaining (never clamped)", () => {
    const s = budgetStatus({ limitUsd: "10.000000", currentSpendUsd: "12.500000" });
    expect(s.status).toBe("over_limit");
    expect(s.remainingUsd).toBe("-2.500000");
    expect(s.utilization).toBe("1.250000");
  });

  it("handles zero spend", () => {
    const s = budgetStatus({ limitUsd: "5.000000", currentSpendUsd: "0" });
    expect(s.status).toBe("below_limit");
    expect(s.remainingUsd).toBe("5.000000");
    expect(s.utilization).toBe("0.000000");
  });

  it("uses exact decimal division (no float drift)", () => {
    const s = budgetStatus({ limitUsd: "3.000000", currentSpendUsd: "1.000000" });
    expect(s.utilization).toBe("0.333333");
  });
});
