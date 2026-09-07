import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export class LcaError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(input: {
    httpStatus: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(input.message);
    this.httpStatus = input.httpStatus;
    this.code = input.code;
    if (input.details) this.details = input.details;
  }
}

export function mapErrorToResponse(err: FastifyError | LcaError | Error): {
  status: number;
  body: ErrorBody;
} {
  if (err instanceof LcaError) {
    return {
      status: err.httpStatus,
      body: { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
    };
  }
  const fastifyErr = err as FastifyError;
  if (typeof fastifyErr.statusCode === "number") {
    return {
      status: fastifyErr.statusCode,
      body: {
        error: {
          code: fastifyErr.code ?? "http_error",
          message: fastifyErr.message ?? "request failed",
        },
      },
    };
  }
  return {
    status: 500,
    body: { error: { code: "internal_error", message: "internal server error" } },
  };
}

export async function errorHandler(
  err: FastifyError | LcaError | Error,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const mapped = mapErrorToResponse(err);
  req.log.warn({ err: err.message, code: mapped.body.error.code }, "request failed");
  await reply.status(mapped.status).send(mapped.body);
}
