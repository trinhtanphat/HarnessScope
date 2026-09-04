#!/usr/bin/env node
import {
  copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { compareSessions } from '../src/core/compare.mjs';
import { exportSession } from '../src/core/exporter.mjs';
import { inferFindings } from '../src/core/infer.mjs';
import { appendEvent, openWorkspace, replaceFindings } from '../src/core/store.mjs';
import { redactValue } from '../src/core/redact.mjs';
import { importHar } from '../src/importers/har.mjs';
import { importJsonl } from '../src/importers/jsonl.mjs';
import { importProcmon } from '../src/importers/procmon.mjs';

const [caseName, fixturePath, ...rest] = process.argv.slice(2);
if (!caseName || !fixturePath || rest.length) {
  console.error('usage: parity-node.mjs <case> <fixture>');
  process.exit(2);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function exportParity(path) {
  const temp = mkdtempSync(join(tmpdir(), 'harnesscope-node-parity-'));
  const dbPath = join(temp, 'workspace.sqlite');
  const out = join(temp, 'out');
  copyFileSync(path, dbPath);
  const db = openWorkspace(dbPath);
  try {
    const sessionId = '20000000-0000-4000-8000-000000000001';
    const event = appendEvent(db, {
      sessionId,
      id: 'event-tool',
      timestampUtc: '2026-09-04T00:00:01.000Z',
      source: 'fixture',
      kind: 'ToolCall',
      correlationId: 't1',
      data: { name: 'shell', args: { api_key: 'must-not-export', command: 'npm test' } }
    });
    replaceFindings(db, sessionId, [{
      id: 'finding-tool',
      title: 'Observed tool schema: shell',
      category: 'tool_schema',
      confidence: 0.95,
      statement: 'Observed shell command argument.',
      evidenceEventIds: [event.id]
    }]);
    exportSession({ db, sessionId, outDir: out });
    const toolSchemas = {};
    for (const file of readdirSync(join(out, 'tool-schemas')).sort()) {
      toolSchemas[file] = readFileSync(join(out, 'tool-schemas', file), 'utf8');
    }
    return {
      spec: readFileSync(join(out, 'harness-spec.json'), 'utf8'),
      markdown: readFileSync(join(out, 'harness-spec.md'), 'utf8'),
      toolSchemas
    };
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
}

try {
  switch (caseName) {
    case 'model-roundtrip': {
      process.stdout.write(`${JSON.stringify(readJson(fixturePath))}\n`);
      break;
    }
    case 'redaction': {
      const fixture = readJson(fixturePath);
      if (!Array.isArray(fixture)) throw new TypeError('redaction fixture must be an array');
      const output = fixture.map((item) => redactValue(item?.value, item?.keyHint ?? ''));
      process.stdout.write(`${JSON.stringify(output)}\n`);
      break;
    }
    case 'inference': {
      const fixture = readJson(fixturePath);
      if (!Array.isArray(fixture)) throw new TypeError('inference fixture must be an array');
      process.stdout.write(`${JSON.stringify(inferFindings(fixture))}\n`);
      break;
    }
    case 'compare': {
      const fixture = readJson(fixturePath);
      if (!fixture?.a || !fixture?.b) throw new TypeError('compare fixture requires a and b snapshots');
      process.stdout.write(`${JSON.stringify(compareSessions(fixture.a, fixture.b))}\n`);
      break;
    }
    case 'imports-har':
      process.stdout.write(`${JSON.stringify(importHar(fixturePath))}\n`);
      break;
    case 'imports-procmon':
      process.stdout.write(`${JSON.stringify(importProcmon(fixturePath, { date: '2026-09-04' }))}\n`);
      break;
    case 'imports-jsonl':
      process.stdout.write(`${JSON.stringify(importJsonl(fixturePath, join(dirname(fixturePath), 'sample-map.yaml')))}\n`);
      break;
    case 'export':
      process.stdout.write(`${JSON.stringify(exportParity(fixturePath))}\n`);
      break;
    default:
      console.error(`unsupported parity case: ${caseName}`);
      process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
