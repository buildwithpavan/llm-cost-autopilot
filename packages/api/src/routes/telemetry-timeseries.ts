import type { FastifyPluginAsync } from "fastify";

import {
  aggregateTelemetryTimeseries,
  type TimeseriesBucket,
  type TimeseriesFilters,
} from "@lca/persistence";

import type { AppContext } from "../wiring.js";
import { LcaError } from "../plugins/errors.js";

/**
 * Maximum supported window per bucket. Both are bounded by the 30-day
 * full-fidelity raw retention: this endpoint reads raw telemetry_events only
 * (never rollups), so it cannot serve data older than retention.
 */
const MAX_WINDOW_DAYS: Record<TimeseriesBucket, number> = { hour: 30, day: 30 };
const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_MS: Record<TimeseriesBucket, number> = {
  hour: 1 * DAY_MS,
  day: 30 * DAY_MS,
};

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

function parseBucket(value: string | undefined): TimeseriesBucket {
  const b = value ?? "hour";
  if (b !== "hour" && b !== "day") {
    throw new LcaError({
      httpStatus: 400,
      code: "invalid_request",
      message: "invalid bucket: expected 'hour' or 'day'",
      details: { allowed: ["hour", "day"] },
    });
  }
  return b;
}

const plugin: FastifyPluginAsync<AppContext> = async (fastify, deps) => {
  fastify.get("/v1/telemetry/timeseries", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;

    const bucket = parseBucket(q["bucket"]);
    const until = q["until"] ? parseDate(q["until"], "until") : new Date();
    const since = q["since"]
      ? parseDate(q["since"], "since")
      : new Date(until.getTime() - DEFAULT_WINDOW_MS[bucket]);

    if (since.getTime() >= until.getTime()) {
      throw new LcaError({
        httpStatus: 400,
        code: "invalid_request",
        message: "invalid range: since must be strictly before until",
      });
    }
    const maxWindowMs = MAX_WINDOW_DAYS[bucket] * DAY_MS;
    if (until.getTime() - since.getTime() > maxWindowMs) {
      throw new LcaError({
        httpStatus: 400,
        code: "invalid_request",
        message: `requested window exceeds the maximum of ${MAX_WINDOW_DAYS[bucket]} days for bucket '${bucket}'`,
        details: { bucket, maxWindowDays: MAX_WINDOW_DAYS[bucket] },
      });
    }

    const filters: TimeseriesFilters = {
      since: since.toISOString(),
      until: until.toISOString(),
      bucket,
    };
    if (q["clientId"]) filters.clientId = q["clientId"];
    if (q["providerId"]) filters.providerId = q["providerId"];
    if (q["modelId"]) filters.modelId = q["modelId"];

    const buckets = await aggregateTelemetryTimeseries(deps.db, filters);
    return reply.status(200).send({
      window: { since: filters.since, until: filters.until },
      bucket,
      buckets,
    });
  });
};

export default plugin;
