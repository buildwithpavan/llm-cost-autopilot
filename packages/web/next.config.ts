import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@lca/core"],
  poweredByHeader: false,
  typedRoutes: false,
  async rewrites() {
    // Proxy backend requests so the browser never has to hit the API origin
    // directly. In remote/tunneled dev environments only the Next.js port is
    // forwarded, so the API base URL becomes `/api/backend` and this rewrite
    // fans it back to whatever LCA_API_UPSTREAM is set to (defaults to
    // localhost:3000 for local dev).
    const upstream = process.env["LCA_API_UPSTREAM"] ?? "http://localhost:3000";
    return [
      { source: "/api/backend/:path*", destination: `${upstream}/:path*` },
    ];
  },
  webpack: (webpackConfig) => {
    // Allow NodeNext-style ".js" extensions in TS relative imports to resolve
    // to ".ts" / ".tsx" sources at build time.
    webpackConfig.resolve = webpackConfig.resolve ?? {};
    (webpackConfig.resolve as { extensionAlias?: Record<string, string[]> }).extensionAlias = {
      ...((webpackConfig.resolve as { extensionAlias?: Record<string, string[]> }).extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return webpackConfig;
  },
};

export default config;
