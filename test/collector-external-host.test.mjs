import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openWorkspace, createSession } from '../src/core/store.mjs';
import { runExternalCollector } from '../src/collectors/host.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const synthetic = join(root, 'fixtures', 'collectors', 'synthetic-collector.mjs');

test('explicit external command may bind collector id from the validated manifest handshake', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'harnesscope-external-host-'));
  const db = openWorkspace(join(dir, 'workspace.sqlite'));
  const session = createSession(db, 'external', 'cli');
  try {
    const result = await runExternalCollector({
      db,
      sessionId: session.id,
      command: process.execPath,
      args: [synthetic],
      expectedCollectorId: null,
      request: {
        sdkVersion: '1',
        instanceId: 'external-bind-test',
        requestedCapabilities: [],
        paths: [],
        hashFiles: false,
        target: null,
      },
    });
    assert.equal(result.collectorId, 'harnesscope.synthetic.collector');
    assert.equal(result.status, 'stopped');
    assert.equal(result.eventsPersisted, 1);
  } finally {
    db.close();
  }
});
