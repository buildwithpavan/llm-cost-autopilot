import { pino, type Logger } from "pino";

import type { LcaConfig } from "../config.js";

export function createLogger(cfg: LcaConfig): Logger {
  return pino({
    level: cfg.LCA_LOG_LEVEL,
    redact: {
      paths: [
        "req.headers.authorization",
        'req.headers["x-api-key"]',
        "reqBody.override.providerId",
        "reqBody.override.modelId",
      ],
      censor: "[REDACTED:secret]",
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  });
}
