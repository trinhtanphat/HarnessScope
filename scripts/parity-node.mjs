#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { compareSessions } from '../src/core/compare.mjs';
import { inferFindings } from '../src/core/infer.mjs';
import { redactValue } from '../src/core/redact.mjs';

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
    case 'redaction': {
      if (!Array.isArray(fixture)) throw new TypeError('redaction fixture must be an array');
      const output = fixture.map((item) => redactValue(item?.value, item?.keyHint ?? ''));
      process.stdout.write(`${JSON.stringify(output)}\n`);
      break;
    }
    case 'inference': {
      if (!Array.isArray(fixture)) throw new TypeError('inference fixture must be an array');
      process.stdout.write(`${JSON.stringify(inferFindings(fixture))}\n`);
      break;
    }
    case 'compare':
      if (!fixture?.a || !fixture?.b) throw new TypeError('compare fixture requires a and b snapshots');
      process.stdout.write(`${JSON.stringify(compareSessions(fixture.a, fixture.b))}\n`);
      break;
    default:
      console.error(`unsupported parity case: ${caseName}`);
      process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
