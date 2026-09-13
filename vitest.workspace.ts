import { defineWorkspace } from "vitest/config";

// DB-backed suites share the same Postgres instance; run test files in a single
// worker to avoid cross-suite table-wipe interference.
export default defineWorkspace([
  {
    test: {
      name: "backend",
      include: [
        "packages/core/test/**/*.test.ts",
        "packages/providers/test/**/*.test.ts",
        "packages/persistence/test/**/*.test.ts",
        "packages/api/test/**/*.test.ts",
        "packages/cli/test/**/*.test.ts",
      ],
      pool: "forks",
      poolOptions: {
        forks: { singleFork: true },
      },
      fileParallelism: false,
    },
  },
  "packages/web/vitest.config.ts",
]);
