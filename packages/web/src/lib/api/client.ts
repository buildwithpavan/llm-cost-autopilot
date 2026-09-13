import { correlationId } from "../correlation.js";
import { getEnvironment } from "../env.js";

export interface ApiError {
  status: number;
  message: string;
  requestId: string;
}

export class ApiCallError extends Error implements ApiError {
  readonly status: number;
  readonly requestId: string;
  constructor(status: number, message: string, requestId: string) {
    super(message);
    this.name = "ApiCallError";
    this.status = status;
    this.requestId = requestId;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  apiKey?: string;
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const env = getEnvironment();
  const url = `${env.apiBaseUrl.replace(/\/$/, "")}${path}`;
  const rid = correlationId();

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-request-id": rid,
  };
  if (opts.apiKey) headers["authorization"] = `Bearer ${opts.apiKey}`;

  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers,
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  };

  const res = await fetch(url, init);
  const bodyText = await res.text();

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const parsed = JSON.parse(bodyText) as { message?: string };
      if (parsed.message) message = parsed.message;
    } catch {
      /* leave default */
    }
    throw new ApiCallError(res.status, message, rid);
  }

  if (!bodyText) return undefined as unknown as T;
  return JSON.parse(bodyText) as T;
}
