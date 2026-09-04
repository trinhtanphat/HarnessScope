import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkspace, appendEvent } from '../src/core/store.mjs';
import { createDesktopServices } from '../apps/desktop/services.mjs';
import { DesktopError, safeResult } from '../apps/desktop/errors.mjs';
import { assertSessionId, validateLaunchRequest, validateSessionInput } from '../apps/desktop/validators.mjs';

function makeServices() {
  const dir = mkdtempSync(join(tmpdir(), 'harnesscope-desktop-'));
  const dbPath = join(dir, 'workspace.sqlite');
  const dialogs = {
    pickFile: async () => null,
    pickDirectory: async () => null
  };
  return {
    dbPath,
    services: createDesktopServices({
      dbPath,
      dialogs,
      appInfo: { name: 'HarnessScope', version: '0.2.0' },
      platform: 'test-platform'
    })
  };
}

test('desktop validators reject malformed ids and bound session/launch input', () => {
  assert.throws(() => assertSessionId('not-a-uuid'), (error) => error instanceof DesktopError && error.code === 'INVALID_SESSION_ID');
  assert.deepEqual(validateSessionInput({ name: '  demo  ', mode: 'desktop' }), { name: 'demo', mode: 'desktop' });
  assert.deepEqual(validateLaunchRequest({ target: 'node', args: ['fixtures/dummy-agent.mjs'], cwd: '/tmp' }), {
    target: 'node', args: ['fixtures/dummy-agent.mjs'], cwd: '/tmp'
  });
  assert.throws(
    () => validateLaunchRequest({ target: 'node', args: Array.from({ length: 65 }, () => 'x') }),
    (error) => error instanceof DesktopError && error.code === 'INVALID_LAUNCH_REQUEST'
  );
});

test('safeResult returns stable success and normalized failure envelopes', async () => {
  assert.deepEqual(await safeResult(async () => ({ value: 42 })), { ok: true, value: { value: 42 } });
  assert.deepEqual(
    await safeResult(async () => { throw new DesktopError('TEST_FAILURE', 'Safe message'); }),
    { ok: false, code: 'TEST_FAILURE', message: 'Safe message' }
  );
  assert.deepEqual(
    await safeResult(async () => { throw new Error('secret stack detail'); }),
    { ok: false, code: 'DESKTOP_OPERATION_FAILED', message: 'The desktop operation could not be completed.' }
  );
});

test('desktop services create/list sessions and return serializable timeline/inference/compare data', async () => {
  const { dbPath, services } = makeServices();
  assert.deepEqual(await services.appInfo(), { name: 'HarnessScope', version: '0.2.0', platform: 'test-platform' });
  assert.equal((await services.workspaceInfo()).dbPath, dbPath);

  const first = await services.sessionCreate({ name: 'first', mode: 'desktop' });
  const second = await services.sessionCreate({ name: 'second', mode: 'cli' });
  assert.match(first.id, /^[0-9a-f-]{36}$/i);
  assert.equal((await services.sessionList()).length, 2);

  const db = openWorkspace(dbPath);
  appendEvent(db, { sessionId: first.id, id: 'skill-1', kind: 'SkillRead', source: 'fixture', data: { path: 'skills/frontend.md' } });
  db.close();

  const timeline = await services.timelineGet(first.id);
  assert.equal(timeline.session.id, first.id);
  assert.equal(timeline.events[0].kind, 'SkillRead');
  assert.deepEqual(timeline.findings, []);

  const inference = await services.inferenceRun(first.id);
  assert.ok(inference.findings.some((finding) => finding.category === 'skill_loading'));
  assert.doesNotThrow(() => JSON.stringify(inference));

  const comparison = await services.compareRun(first.id, second.id);
  assert.equal(comparison.sessionA.id, first.id);
  assert.equal(comparison.sessionB.id, second.id);
  assert.doesNotThrow(() => JSON.stringify(comparison));
});
