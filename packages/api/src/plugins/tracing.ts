import { context, propagation, trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

import type { LcaConfig } from "../config.js";

let sdk: NodeSDK | undefined;

export function startTracing(cfg: LcaConfig): void {
  if (!cfg.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  sdk = new NodeSDK({
    serviceName: cfg.OTEL_SERVICE_NAME,
    traceExporter: new OTLPTraceExporter({ url: cfg.OTEL_EXPORTER_OTLP_ENDPOINT }),
  });
  sdk.start();
}

export async function stopTracing(): Promise<void> {
  await sdk?.shutdown();
}

export { context, propagation, trace };
