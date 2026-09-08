#!/usr/bin/env node
import { buildProgram } from "./program.js";

export const CLI_VERSION = "0.1.0";

if (import.meta.url === `file://${process.argv[1]}`) {
  const program = buildProgram();
  program.parseAsync(process.argv).catch((err) => {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(1);
  });
}
