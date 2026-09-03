import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkspace, createSession, appendEvent, replaceFindings } from '../src/core/store.mjs';
import { exportSession } from '../src/core/exporter.mjs';

test('exports deterministic clean-room markdown/json and observed tool schemas without secrets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harnesscope-export-'));
  const db = openWorkspace(join(dir, 'workspace.sqlite'));
  const session = createSession(db, 'demo', 'desktop');
  const toolEvent = appendEvent(db, {
    sessionId: session.id, id: 'event-tool', timestampUtc: '2026-09-04T00:00:00.000Z', source: 'fixture', kind: 'ToolCall',
    correlationId: 't1', data: { name: 'shell', args: { command: 'npm test', api_key: 'must-not-export' } }
  });
  replaceFindings(db, session.id, [{
    title: 'Observed tool schema: shell', category: 'tool_schema', confidence: 0.95,
    evidenceEventIds: [toolEvent.id], statement: 'Observed shell command argument.'
  }]);
  const out = join(dir, 'out');
  exportSession({ db, sessionId: session.id, outDir: out });
  const md = readFileSync(join(out, 'harness-spec.md'), 'utf8');
  const json = readFileSync(join(out, 'harness-spec.json'), 'utf8');
  const schema = readFileSync(join(out, 'tool-schemas', 'shell.json'), 'utf8');
  assert.match(md, /HarnessScope Clean-Room Behavioral Spec/);
  assert.match(md, /INFERRED_HIGH/);
  assert.match(schema, /command/);
  assert.doesNotMatch(md + json + schema, /must-not-export/);
  assert.equal(existsSync(join(out, 'tool-schemas', 'shell.json')), true);
  const first = readFileSync(join(out, 'harness-spec.json'), 'utf8');
  exportSession({ db, sessionId: session.id, outDir: out });
  assert.equal(readFileSync(join(out, 'harness-spec.json'), 'utf8'), first);
  db.close();
});
