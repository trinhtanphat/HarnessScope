import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSession,
  listEvents,
  openWorkspace,
} from '../src/core/store.mjs';
import { sanitizeCollectorEnv } from '../src/collectors/environment.mjs';
import {
  describeCollector,
  listCollectorManifests,
} from '../src/collectors/registry.mjs';
import {
  MAX_PENDING_ENVELOPES,
  runExternalCollector,
} from '../src/collectors/host.mjs';

const fixture = fileURLToPath(new URL('../fixtures/collectors/synthetic-collector.mjs', import.meta.url));
const sentinel = 'collector-secret-9f8e7d6c';

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'harnesscope-collector-host-'));
  const dbPath = join(dir, 'workspace.sqlite');
  const db = openWorkspace(dbPath);
  const session = createSession(db, 'collector-host', 'cli');
  return { dir, dbPath, db, session };
}

function request(instanceId = 'instance-1', capabilities = ['process.lifecycle']) {
  return {
    sdkVersion: '1',
    collectorId: 'harnesscope.synthetic.collector',
    instanceId,
    requestedCapabilities: capabilities,
    paths: [],
    hashFiles: false,
    target: null,
  };
}

function run(db, sessionId, mode, overrides = {}) {
  return runExternalCollector({
    db,
    sessionId,
    command: process.execPath,
    args: [fixture, '--mode', mode],
    request: request(`instance-${mode}`),
    ...overrides,
  });
}

test('collector registry filters first-party manifests by platform', () => {
  assert.deepEqual(listCollectorManifests({ platform: 'win32' }), []);
  assert.deepEqual(listCollectorManifests({ platform: 'linux' }).map((value) => value.id), [
    'harnesscope.linux.process-files',
  ]);
  assert.deepEqual(listCollectorManifests({ platform: 'darwin' }).map((value) => value.id), [
    'harnesscope.macos.process-files',
  ]);
  assert.equal(describeCollector('harnesscope.linux.process-files', { platform: 'linux' })?.sdkVersion, '1');
  assert.equal(describeCollector('missing.collector.id', { platform: 'linux' }), null);
});

test('collector environment strips sensitive names and keeps only bounded runtime variables', () => {
  const env = sanitizeCollectorEnv({
    PATH: '/safe/bin',
    HOME: '/safe/home',
    LANG: 'en_US.UTF-8',
    API_TOKEN: sentinel,
    AUTH_SECRET: sentinel,
    COOKIE_JAR: sentinel,
    RANDOM_UNSAFE: 'drop-me',
  });
  assert.equal(env.PATH, '/safe/bin');
  assert.equal(env.HOME, '/safe/home');
  assert.equal(env.LANG, 'en_US.UTF-8');
  assert.equal(env.API_TOKEN, undefined);
  assert.equal(env.AUTH_SECRET, undefined);
  assert.equal(env.COOKIE_JAR, undefined);
  assert.equal(env.RANDOM_UNSAFE, undefined);
});

test('external collector requires manifest handshake, ignores stderr as evidence, and stops cleanly', async () => {
  const { db, session } = workspace();
  try {
    const statuses = [];
    const result = await run(db, session.id, 'basic', { onStatus: (status) => statuses.push(status) });
    assert.equal(result.collectorId, 'harnesscope.synthetic.collector');
    assert.equal(result.instanceId, 'instance-basic');
    assert.equal(result.eventsPersisted, 1);
    assert.equal(result.status, 'stopped');
    assert.ok(statuses.includes('running'));
    assert.ok(statuses.includes('stopped'));
    const events = listEvents(db, session.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'ProcessStarted');
    assert.equal(events[0].source, 'collector');
    assert.doesNotMatch(JSON.stringify(events), /STDERR_FAKE_EVENT/);
  } finally {
    db.close();
  }
});

test('malformed protocol, duplicate sequence and oversize line fail only the owned collector instance', async () => {
  for (const [mode, code] of [
    ['malformed', 'COLLECTOR_PROTOCOL_ERROR'],
    ['duplicate', 'COLLECTOR_SEQUENCE_ERROR'],
    ['oversize', 'COLLECTOR_PROTOCOL_ERROR'],
  ]) {
    const { db, session } = workspace();
    try {
      await assert.rejects(run(db, session.id, mode), (error) => error?.code === code);
      assert.doesNotThrow(() => createSession(db, `after-${mode}`, 'cli'));
    } finally {
      db.close();
    }
  }
});

test('collector child does not inherit sensitive environment variables', async () => {
  const previous = process.env.HARNESSCOPE_TEST_TOKEN;
  process.env.HARNESSCOPE_TEST_TOKEN = sentinel;
  const { db, session } = workspace();
  try {
    await run(db, session.id, 'env');
    const [event] = listEvents(db, session.id);
    assert.equal(event.data.sensitiveEnvPresent, false);
  } finally {
    db.close();
    if (previous === undefined) delete process.env.HARNESSCOPE_TEST_TOKEN;
    else process.env.HARNESSCOPE_TEST_TOKEN = previous;
  }
});

test('collector event sentinel is redacted before SQLite or WAL persistence', async () => {
  const { db, dbPath, session } = workspace();
  try {
    await run(db, session.id, 'secret');
    const [event] = listEvents(db, session.id);
    assert.equal(event.data.apiKey, '[REDACTED]');
    assert.equal(event.redaction, 'redacted');
    const persisted = [dbPath, `${dbPath}-wal`]
      .filter((path) => existsSync(path))
      .map((path) => readFileSync(path).toString('utf8'))
      .join('\n');
    assert.doesNotMatch(persisted, new RegExp(sentinel));
  } finally {
    db.close();
  }
});

test('collector host has an exact bounded queue and fails closed on overflow', async () => {
  assert.equal(MAX_PENDING_ENVELOPES, 256);
  const { db, session } = workspace();
  try {
    await assert.rejects(run(db, session.id, 'overflow'), (error) => error?.code === 'COLLECTOR_BACKPRESSURE');
  } finally {
    db.close();
  }
});
