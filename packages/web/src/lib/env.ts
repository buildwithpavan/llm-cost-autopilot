/**
 * Runtime environment surface. Values that legitimately belong to backend
 * telemetry (e.g. pricingTableVersionId) MUST come from the API — this module
 * is for frontend deployment metadata only.
 *
 * Next.js only inlines `process.env.NEXT_PUBLIC_*` when accessed via a
 * literal property (not `process.env[dynamic]`), so every read below is
 * spelled out explicitly.
 */

export interface Environment {
  apiBaseUrl: string;
  apiKey?: string;
  envLabel: "production" | "staging" | "dev" | "local";
  region: string;
  appVersion: string;
  devMode: boolean;
}

export function getEnvironment(): Environment {
  const apiKey = process.env.NEXT_PUBLIC_LCA_API_KEY;
  return {
    apiBaseUrl: process.env.NEXT_PUBLIC_LCA_API_BASE_URL ?? "http://localhost:3000",
    envLabel:
      (process.env.NEXT_PUBLIC_LCA_ENV as Environment["envLabel"] | undefined) ?? "production",
    region: process.env.NEXT_PUBLIC_LCA_REGION ?? "ap-south-1",
    appVersion: process.env.NEXT_PUBLIC_LCA_APP_VERSION ?? "v0.1.0",
    devMode: process.env.NEXT_PUBLIC_LCA_DEV_MODE === "1",
    ...(apiKey ? { apiKey } : {}),
  };
}

