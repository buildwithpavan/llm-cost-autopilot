import { Decimal, type DecimalInstance } from "./decimal.js";

const ABSOLUTE_FLOOR = new Decimal("0.001");
const PCT = new Decimal("0.05");

export interface ReconciledInput {
  readonly estimatedUsd: string;
  readonly actualUsd: string;
}

/** FR-019a: abs(est − actual) ≤ max($0.001, 5% × actual). */
export function isReconciled(input: ReconciledInput): boolean {
  const est: DecimalInstance = new Decimal(input.estimatedUsd);
  const actual: DecimalInstance = new Decimal(input.actualUsd);
  const diff = est.minus(actual).abs();
  const pctFloor = actual.abs().times(PCT);
  const threshold = pctFloor.gt(ABSOLUTE_FLOOR) ? pctFloor : ABSOLUTE_FLOOR;
  return diff.lte(threshold);
}
