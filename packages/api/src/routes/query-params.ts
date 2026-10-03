import { LcaError } from "../plugins/errors.js";

/**
 * Parse an ISO-8601 date query parameter, rejecting malformed values
 * deterministically with the structured 400 contract (so an invalid date never
 * reaches `new Date(...)` in the persistence layer, where it would surface as an
 * opaque 500 when serialized for SQL).
 */
export function parseIsoDateParam(value: string, field: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new LcaError({
      httpStatus: 400,
      code: "invalid_request",
      message: `invalid ${field}: expected an ISO-8601 timestamp`,
    });
  }
  return d;
}

/**
 * Parse a pagination `limit` query parameter. Rejects non-integer or < 1 values
 * with a deterministic 400 so malformed input never reaches SQL as `NaN`
 * (`Number("abc")` → `NaN`). Large values are accepted here and bounded by the
 * persistence layer's clamp, preserving the established capping behavior.
 */
export function parseLimitParam(value: string, field = "limit"): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new LcaError({
      httpStatus: 400,
      code: "invalid_request",
      message: `invalid ${field}: expected a positive integer`,
    });
  }
  return n;
}
