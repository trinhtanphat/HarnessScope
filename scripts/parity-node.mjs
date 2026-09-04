#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const [caseName, fixturePath, ...rest] = process.argv.slice(2);
if (!caseName || !fixturePath || rest.length) {
  console.error('usage: parity-node.mjs <case> <fixture>');
  process.exit(2);
}

try {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  switch (caseName) {
    case 'model-roundtrip':
      process.stdout.write(`${JSON.stringify(fixture)}\n`);
      break;
    default:
      console.error(`unsupported parity case: ${caseName}`);
      process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
