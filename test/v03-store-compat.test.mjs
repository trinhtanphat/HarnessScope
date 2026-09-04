import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkspace, listEvents, listFindings, listSessions } from '../src/core/store.mjs';

const fixture = new URL('../fixtures/v02-workspace/workspace.sqlite', import.meta.url);
const sessionId = '20000000-0000-4000-8000-000000000001';

test('committed v0.2 workspace fixture opens through the released Node-compatible store contract', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harnesscope-v02-compat-'));
  const dbPath = join(dir, 'workspace.sqlite');
  copyFileSync(fixture, dbPath);
  const db = openWorkspace(dbPath);
  try {
    const sessions = listSessions(db);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, sessionId);
    assert.equal(sessions[0].name, 'v0.2 compatibility fixture');
    const events = listEvents(db, sessionId);
    assert.equal(events[0].data.Authorization, '[REDACTED]');
    assert.equal(events[0].redaction, 'redacted');
    const findings = listFindings(db, sessionId);
    assert.equal(findings[0].id, '20000000-0000-4000-8000-000000000003');
    assert.deepEqual(findings[0].evidenceEventIds, ['20000000-0000-4000-8000-000000000002']);
  } finally {
    db.close();
  }
  assert.equal(readFileSync(dbPath).includes(Buffer.from('fixture-secret-must-not-persist')), false);
});
