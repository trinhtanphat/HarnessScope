import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkspace, createSession, appendEvent, listEvents, replaceFindings, listFindings } from '../src/core/store.mjs';

test('stores redacted append-only events and findings with provenance', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harnesscope-store-'));
  const dbPath = join(dir, 'workspace.sqlite');
  const db = openWorkspace(dbPath);
  const session = createSession(db, 'demo', 'desktop');
  const event = appendEvent(db, {
    sessionId: session.id,
    timestampUtc: '2026-09-04T00:00:00.000Z',
    source: 'fixture',
    kind: 'HttpRequest',
    correlationId: 'c1',
    data: { Authorization: 'Bearer never-store-this', path: '/v1/messages' }
  });
  const events = listEvents(db, session.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].id, event.id);
  assert.equal(events[0].redaction, 'redacted');
  assert.equal(events[0].data.Authorization, '[REDACTED]');
  replaceFindings(db, session.id, [{
    title: 'Tool loop', category: 'execution_loop', confidence: 0.9,
    evidenceEventIds: [event.id], statement: 'Observed a tool loop.'
  }]);
  const findings = listFindings(db, session.id);
  assert.equal(findings[0].evidenceEventIds[0], event.id);
  db.close();
  const bytes = readFileSync(dbPath);
  assert.equal(bytes.includes(Buffer.from('never-store-this')), false);
});
