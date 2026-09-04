import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportSession } from '../src/core/exporter.mjs';
import {
  appendCollectorEvent,
  createSession,
  listEvents,
  openWorkspace,
} from '../src/core/store.mjs';
import { runExternalCollector } from '../src/collectors/host.mjs';
import { resolveNativeCollectorBinary } from '../src/collectors/native-sidecar.mjs';

const SENTINEL = 'collector-secret-9f8e7d6c';
const root = fileURLToPath(new URL('../', import.meta.url));

function collectorId() {
  if (process.platform === 'linux') return 'harnesscope.linux.process-files';
  if (process.platform === 'darwin') return 'harnesscope.macos.process-files';
  throw new Error(`Native collector smoke is unsupported on ${process.platform}.`);
}

function persistedText(paths) {
  return paths
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path).toString('utf8'))
    .join('\n');
}

const temp = mkdtempSync(join(tmpdir(), 'harnesscope-native-smoke-'));
const selected = join(temp, 'selected');
const sibling = join(temp, 'sibling');
const dbPath = join(temp, 'workspace.sqlite');
const outDir = join(temp, 'export');
mkdirSync(selected, { recursive: true });
mkdirSync(sibling, { recursive: true });

const db = openWorkspace(dbPath);
try {
  const session = createSession(db, 'native-collector-smoke', 'cli');
  const id = collectorId();
  const instanceId = `native-smoke-${randomUUID()}`;
  const fixture = join(root, 'fixtures', 'collectors', 'synthetic-target.mjs');
  const binary = resolveNativeCollectorBinary({ cwd: root });

  const result = await runExternalCollector({
    db,
    sessionId: session.id,
    command: binary,
    request: {
      sdkVersion: '1',
      collectorId: id,
      instanceId,
      requestedCapabilities: [
        'process.lifecycle',
        'process.metadata',
        'file.metadata',
        'collector.diagnostics',
      ],
      paths: [selected],
      hashFiles: true,
      target: {
        executable: process.execPath,
        args: [
          fixture,
          '--selected', selected,
          '--sibling', sibling,
        ],
        cwd: root,
      },
    },
    expectedCollectorId: id,
  });

  assert.equal(result.status, 'stopped');
  appendCollectorEvent(db, session.id, {
    source: 'collector-smoke',
    kind: 'Unknown',
    correlationId: 'redaction-probe',
    data: { apiKey: SENTINEL },
  });

  const events = listEvents(db, session.id);
  assert.ok(events.some((event) => event.kind === 'ProcessStarted'), 'missing ProcessStarted evidence');
  assert.ok(events.some((event) => event.kind === 'ProcessExited'), 'missing ProcessExited evidence');

  const selectedRoot = realpathSync(selected);
  const siblingRoot = realpathSync(sibling);
  const fileEvents = events.filter((event) => event.kind.startsWith('File'));
  assert.ok(fileEvents.length > 0, 'missing native file metadata evidence');
  assert.ok(
    fileEvents.some((event) => String(event.data?.path ?? '').startsWith(selectedRoot)),
    'missing selected-directory file metadata evidence',
  );
  assert.ok(
    fileEvents.every((event) => !String(event.data?.path ?? '').startsWith(siblingRoot)),
    'out-of-scope sibling file metadata was persisted',
  );

  const probe = events.find((event) => event.correlationId === 'redaction-probe');
  assert.equal(probe?.data?.apiKey, '[REDACTED]');
  assert.equal(probe?.redaction, 'redacted');

  exportSession({ db, sessionId: session.id, outDir });
  const rawPersistence = persistedText([dbPath, `${dbPath}-wal`]);
  assert.equal(rawPersistence.includes(SENTINEL), false, 'sentinel leaked into SQLite/WAL bytes');

  const exported = persistedText([
    join(outDir, 'harness-spec.json'),
    join(outDir, 'harness-spec.md'),
  ]);
  assert.equal(exported.includes(SENTINEL), false, 'sentinel leaked into exported spec');

  console.log(JSON.stringify({
    ok: true,
    collectorId: id,
    events: events.length,
    fileEvents: fileEvents.length,
  }));
} finally {
  db.close();
}
