import type { FastifyPluginAsync } from "fastify";

import {
  operatorRuleInputSchema,
  type OperatorRule,
  type OperatorRuleInput,
} from "@lca/core";
import type { OperatorRuleStore } from "@lca/persistence";

import { LcaError } from "../plugins/errors.js";

export interface RulesDeps {
  ruleStore: OperatorRuleStore;
}

const plugin: FastifyPluginAsync<RulesDeps> = async (fastify, deps) => {
  fastify.get<{ Reply: OperatorRule[] }>("/v1/operator/rules", async (_req, reply) => {
    const rules = await deps.ruleStore.list();
    return reply.status(200).send(rules);
  });

  fastify.post<{ Body: OperatorRuleInput; Reply: OperatorRule }>(
    "/v1/operator/rules",
    async (req, reply) => {
      const parsed = operatorRuleInputSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new LcaError({
          httpStatus: 400,
          code: "invalid_request",
          message: "malformed operator rule",
          details: { issues: parsed.error.issues },
        });
      }
      const rule = await deps.ruleStore.create(parsed.data);
      return reply.status(201).send(rule);
    },
  );

  fastify.patch<{
    Params: { ruleId: string };
    Body: Partial<OperatorRuleInput>;
    Reply: OperatorRule;
  }>("/v1/operator/rules/:ruleId", async (req, reply) => {
    const parsed = operatorRuleInputSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      throw new LcaError({
        httpStatus: 400,
        code: "invalid_request",
        message: "malformed rule patch",
        details: { issues: parsed.error.issues },
      });
    }
    const { ruleId } = req.params;
    // exactOptionalPropertyTypes: strip undefined keys before handing to the store.
    const patch: Partial<OperatorRuleInput> = {};
    if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;
    if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
    if (parsed.data.match !== undefined) patch.match = parsed.data.match;
    if (parsed.data.pin !== undefined) patch.pin = parsed.data.pin;
    const updated = await deps.ruleStore.update(ruleId, patch);
    if (!updated) {
      throw new LcaError({
        httpStatus: 404,
        code: "rule_not_found",
        message: `no rule with id ${ruleId}`,
      });
    }
    return reply.status(200).send(updated);
  });

  fastify.delete<{ Params: { ruleId: string } }>(
    "/v1/operator/rules/:ruleId",
    async (req, reply) => {
      const { ruleId } = req.params;
      const removed = await deps.ruleStore.remove(ruleId);
      if (!removed) {
        throw new LcaError({
          httpStatus: 404,
          code: "rule_not_found",
          message: `no rule with id ${ruleId}`,
        });
      }
      return reply.status(204).send();
    },
  );
};

export default plugin;
