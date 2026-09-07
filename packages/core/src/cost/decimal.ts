import { createRequire } from "node:module";

/** decimal.js-light publishes as a CJS `export = Decimal` class whose types
 * don't survive NodeNext ESM interop cleanly. Load via createRequire. */
const require = createRequire(import.meta.url);

// The runtime shape is a Decimal constructor with static ROUND_HALF_UP.
export interface DecimalStatic {
  new (value: string | number): DecimalInstance;
  set(config: { precision?: number }): DecimalStatic;
  ROUND_HALF_UP: number;
}

export interface DecimalInstance {
  plus(v: DecimalInstance | string | number): DecimalInstance;
  minus(v: DecimalInstance | string | number): DecimalInstance;
  times(v: DecimalInstance | string | number): DecimalInstance;
  div(v: DecimalInstance | string | number): DecimalInstance;
  abs(): DecimalInstance;
  eq(v: DecimalInstance | string | number): boolean;
  gt(v: DecimalInstance | string | number): boolean;
  gte(v: DecimalInstance | string | number): boolean;
  lt(v: DecimalInstance | string | number): boolean;
  lte(v: DecimalInstance | string | number): boolean;
  toFixed(n?: number): string;
  toString(): string;
}

export const Decimal = require("decimal.js-light") as DecimalStatic;

Decimal.set({ precision: 40 });
