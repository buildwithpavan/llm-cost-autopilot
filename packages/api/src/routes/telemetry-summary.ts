import type { FastifyPluginAsync } from "fastify";

import { aggregateRecentTelemetry, type QueryFilters } from "@lca/persistence";

import type { AppContext } from "../wiring.js";
import { LcaError } from "../plugins/errors.js";

/** Maximum supported window, aligned with the 30-day full-fidelity retention boundary. */
const MAX_WINDOW_DAYS = 30;
const MAX_WINDOW_MS = MAX_WINDOW_DAYS * 86_400_000;

function parseDate(value: string, field: string): Date {
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

const plugin: FastifyPluginAsync<AppContext> = async (fastify, deps) => {
  fastify.get("/v1/telemetry/summary", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;

    const until = q["until"] ? parseDate(q["until"], "until") : new Date();
    const since = q["since"]
      ? parseDate(q["since"], "since")
      : new Date(until.getTime() - MAX_WINDOW_MS);

    if (since.getTime() >= until.getTime()) {
      throw new LcaError({
        httpStatus: 400,
        code: "invalid_request",
        message: "invalid range: since must be strictly before until",
      });
    }
    if (until.getTime() - since.getTime() > MAX_WINDOW_MS) {
      throw new LcaError({
        httpStatus: 400,
        code: "invalid_request",
        message: `requested window exceeds the maximum of ${MAX_WINDOW_DAYS} days`,
        details: { maxWindowDays: MAX_WINDOW_DAYS },
      });
    }

    const filters: QueryFilters = {
      since: since.toISOString(),
      until: until.toISOString(),
    };
    if (q["clientId"]) filters.clientId = q["clientId"];
    if (q["providerId"]) filters.providerId = q["providerId"];
    if (q["modelId"]) filters.modelId = q["modelId"];

    const summary = await aggregateRecentTelemetry(deps.db, filters);
    return reply.status(200).send({
      window: { since: filters.since, until: filters.until },
      ...summary,
    });
  });
};

export default plugin;
