#!/usr/bin/env node
import { runCli } from '../src/cli.mjs';

try {
  const code = await runCli();
  if (Number.isInteger(code)) process.exitCode = code;
} catch (error) {
  process.stderr.write(`HarnessScope: ${error.message}\n`);
  process.exitCode = 1;
}
