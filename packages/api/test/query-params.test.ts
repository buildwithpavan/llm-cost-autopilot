import { describe, expect, it } from "vitest";

import { parseIsoDateParam, parseLimitParam } from "../src/routes/query-params.js";
import { LcaError } from "../src/plugins/errors.js";

describe("parseIsoDateParam", () => {
  it("accepts a valid ISO-8601 timestamp", () => {
    const d = parseIsoDateParam("2026-10-01T00:00:00.000Z", "since");
    expect(d.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("accepts a date-only value", () => {
    expect(parseIsoDateParam("2026-10-01", "fromDate").toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("rejects a malformed date with a structured 400", () => {
    try {
      parseIsoDateParam("not-a-date", "since");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(LcaError);
      const e = err as LcaError;
      expect(e.httpStatus).toBe(400);
      expect(e.code).toBe("invalid_request");
      expect(e.message).toContain("since");
    }
  });
});

describe("parseLimitParam", () => {
  it("accepts positive integers (including large values that are clamped downstream)", () => {
    expect(parseLimitParam("5")).toBe(5);
    expect(parseLimitParam("1000000")).toBe(1_000_000);
  });

  it("rejects non-numeric values (prevents NaN reaching SQL)", () => {
    expect(() => parseLimitParam("abc")).toThrow(LcaError);
  });

  it("rejects zero, negative, and non-integer values", () => {
    for (const v of ["0", "-5", "1.5", "Infinity", ""]) {
      expect(() => parseLimitParam(v)).toThrow(LcaError);
    }
  });

  it("uses the given field name in the error", () => {
    try {
      parseLimitParam("abc", "limit");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as LcaError).httpStatus).toBe(400);
      expect((err as LcaError).message).toContain("limit");
    }
  });
});
