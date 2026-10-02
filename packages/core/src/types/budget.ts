import { z } from "zod";

import { Decimal } from "../cost/decimal.js";

export const budgetScopeSchema = z.enum(["global", "client"]);
export type BudgetScope = z.infer<typeof budgetScopeSchema>;

export const budgetPeriodSchema = z.enum(["daily", "rolling_30d"]);
export type BudgetPeriod = z.infer<typeof budgetPeriodSchema>;

export const budgetActionSchema = z.enum(["block", "warn"]);
export type BudgetAction = z.infer<typeof budgetActionSchema>;

/** Decimal USD string, strictly > 0, at most 6 fractional digits (NUMERIC(20,6)). */
export const limitUsdSchema = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "limitUsd must be a decimal string with at most 6 fractional digits")
  .refine((s) => new Decimal(s).gt(0), "limitUsd must be strictly greater than zero");

const budgetBaseShape = {
  scope: budgetScopeSchema,
  clientId: z.string().min(1).nullable().default(null),
  period: budgetPeriodSchema,
  limitUsd: limitUsdSchema,
  action: budgetActionSchema,
  enabled: z.boolean().default(true),
};

/** scope/clientId coherence: global → null clientId; client → non-empty clientId. */
const scopeClientOk = (b: { scope: BudgetScope; clientId: string | null }): boolean =>
  b.scope === "global" ? b.clientId === null : !!b.clientId && b.clientId.length > 0;

const SCOPE_CLIENT_MESSAGE =
  "global budgets must have a null clientId; client budgets must have a non-empty clientId";

export const budgetInputSchema = z
  .object(budgetBaseShape)
  .refine(scopeClientOk, { message: SCOPE_CLIENT_MESSAGE, path: ["clientId"] });
export type BudgetInput = z.infer<typeof budgetInputSchema>;

export const budgetSchema = z
  .object({
    ...budgetBaseShape,
    budgetId: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .refine(scopeClientOk, { message: SCOPE_CLIENT_MESSAGE, path: ["clientId"] });
export type Budget = z.infer<typeof budgetSchema>;
