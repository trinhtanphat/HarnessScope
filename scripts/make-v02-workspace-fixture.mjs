import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  appendEvent,
  openWorkspace,
  replaceFindings
} from '../src/core/store.mjs';

const target = resolve('fixtures/v02-workspace/workspace.sqlite');
mkdirSync(dirname(target), { recursive: true });
rmSync(target, { force: true });
rmSync(`${target}-wal`, { force: true });
rmSync(`${target}-shm`, { force: true });

const sessionId = '20000000-0000-4000-8000-000000000001';
const eventId = '20000000-0000-4000-8000-000000000002';
const findingId = '20000000-0000-4000-8000-000000000003';

const db = openWorkspace(target);
try {
  db.prepare('INSERT INTO sessions(id,name,mode,created_utc) VALUES(?,?,?,?)').run(
    sessionId,
    'v0.2 compatibility fixture',
    'cli',
    '2026-09-04T00:00:00.000Z'
  );

  appendEvent(db, {
    id: eventId,
    sessionId,
    timestampUtc: '2026-09-04T00:00:01.000Z',
    source: 'fixture',
    kind: 'ToolCall',
    correlationId: 'fixture-correlation',
    data: {
      Authorization: 'Bearer fixture-secret-must-not-persist-1234567890',
      name: 'fixture-tool',
      safe: 'synthetic'
    }
  });

  replaceFindings(db, sessionId, [{
    id: findingId,
    title: 'Compatibility fixture finding',
    category: 'compatibility_fixture',
    confidence: 0.95,
    statement: 'Synthetic v0.2 compatibility evidence.',
    evidenceEventIds: [eventId]
  }]);

  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  db.exec('PRAGMA journal_mode=DELETE;');
} finally {
  db.close();
}

console.log(target);
