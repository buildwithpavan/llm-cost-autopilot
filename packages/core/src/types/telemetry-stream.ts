/**
 * Stage-level telemetry stream event contract.
 *
 * Emitted by the API during a completion request and delivered over SSE at
 * GET /v1/telemetry/events/stream. Every field is either already-persisted
 * telemetry state or a trivially-derived slice of it; no fabricated values.
 *
 * The final `event.completed` payload carries the fully-assembled
 * TelemetryEvent (identical to what GET /v1/telemetry/events returns), so
 * clients that only care about final state can subscribe to that eventType
 * alone.
 */
import { z } from "zod";

import {
  attemptSchema,
  candidateScoreSchema,
  decisionSourceSchema,
  errorClassSchema,
  routingDecisionSchema,
  shadowedSourceSchema,
  telemetryEventSchema,
} from "./telemetry.js";

export const streamEventTypeSchema = z.enum([
  "stream.hello",
  "stream.heartbeat",
  "request.received",
  "governance.completed",
  "candidate.evaluated",
  "candidate.excluded",
  "decision.committed",
  "execution.started",
  "execution.completed",
  "result.completed",
  "result.failed",
  "event.completed",
]);
export type StreamEventType = z.infer<typeof streamEventTypeSchema>;

const streamEventEnvelope = {
  seq: z.number().int().nonnegative(),
  eventType: streamEventTypeSchema,
  eventId: z.string(),
  clientId: z.string(),
  timestamp: z.string().datetime(),
};

export const requestReceivedPayloadSchema = z.object({
  ...streamEventEnvelope,
  eventType: z.literal("request.received"),
  estimatedInputTokens: z.number().int().nonnegative(),
  requiredCapabilities: z.array(z.string()),
});

export const governanceCompletedPayloadSchema = z.object({
  ...streamEventEnvelope,
  eventType: z.literal("governance.completed"),
  decisionSource: decisionSourceSchema,
  shadowedSource: shadowedSourceSchema,
  matchedRuleId: z.string().nullable(),
});

export const candidateEvaluatedPayloadSchema = z.object({
  ...streamEventEnvelope,
  eventType: z.literal("candidate.evaluated"),
  candidate: candidateScoreSchema,
});

export const candidateExcludedPayloadSchema = z.object({
  ...streamEventEnvelope,
  eventType: z.literal("candidate.excluded"),
  candidate: candidateScoreSchema,
});

export const decisionCommittedPayloadSchema = z.object({
  ...streamEventEnvelope,
  eventType: z.literal("decision.committed"),
  decision: routingDecisionSchema,
});

export const executionStartedPayloadSchema = z.object({
  ...streamEventEnvelope,
  eventType: z.literal("execution.started"),
  attemptIndex: z.number().int().nonnegative(),
  providerId: z.string(),
  modelId: z.string(),
});

export const executionCompletedPayloadSchema = z.object({
  ...streamEventEnvelope,
  eventType: z.literal("execution.completed"),
  attempt: attemptSchema,
});

export const resultCompletedPayloadSchema = z.object({
  ...streamEventEnvelope,
  eventType: z.literal("result.completed"),
  totalLatencyMs: z.number().int().nonnegative(),
  terminalErrorClass: errorClassSchema,
});

export const resultFailedPayloadSchema = z.object({
  ...streamEventEnvelope,
  eventType: z.literal("result.failed"),
  totalLatencyMs: z.number().int().nonnegative(),
  terminalErrorClass: errorClassSchema,
});

export const eventCompletedPayloadSchema = z.object({
  ...streamEventEnvelope,
  eventType: z.literal("event.completed"),
  event: telemetryEventSchema,
});

export const streamHelloPayloadSchema = z.object({
  ...streamEventEnvelope,
  eventType: z.literal("stream.hello"),
  clientId: z.string(),
  eventId: z.literal(""),
});

export const streamHeartbeatPayloadSchema = z.object({
  ...streamEventEnvelope,
  eventType: z.literal("stream.heartbeat"),
  eventId: z.literal(""),
});

export const telemetryStreamEventSchema = z.discriminatedUnion("eventType", [
  streamHelloPayloadSchema,
  streamHeartbeatPayloadSchema,
  requestReceivedPayloadSchema,
  governanceCompletedPayloadSchema,
  candidateEvaluatedPayloadSchema,
  candidateExcludedPayloadSchema,
  decisionCommittedPayloadSchema,
  executionStartedPayloadSchema,
  executionCompletedPayloadSchema,
  resultCompletedPayloadSchema,
  resultFailedPayloadSchema,
  eventCompletedPayloadSchema,
]);

export type TelemetryStreamEvent = z.infer<typeof telemetryStreamEventSchema>;
export type RequestReceivedEvent = z.infer<typeof requestReceivedPayloadSchema>;
export type GovernanceCompletedEvent = z.infer<typeof governanceCompletedPayloadSchema>;
export type CandidateEvaluatedEvent = z.infer<typeof candidateEvaluatedPayloadSchema>;
export type CandidateExcludedEvent = z.infer<typeof candidateExcludedPayloadSchema>;
export type DecisionCommittedEvent = z.infer<typeof decisionCommittedPayloadSchema>;
export type ExecutionStartedEvent = z.infer<typeof executionStartedPayloadSchema>;
export type ExecutionCompletedEvent = z.infer<typeof executionCompletedPayloadSchema>;
export type ResultCompletedEvent = z.infer<typeof resultCompletedPayloadSchema>;
export type ResultFailedEvent = z.infer<typeof resultFailedPayloadSchema>;
export type EventCompletedEvent = z.infer<typeof eventCompletedPayloadSchema>;
