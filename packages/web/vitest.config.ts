import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    pool: "forks",
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
});
