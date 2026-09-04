import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCli } from '../src/cli.mjs';
import { resolveNativeCollectorBinary } from '../src/collectors/native-sidecar.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write(value) { stdout += String(value); } },
      stderr: { write(value) { stderr += String(value); } },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function platformCollectorId() {
  if (process.platform === 'linux') return 'harnesscope.linux.process-files';
  if (process.platform === 'darwin') return 'harnesscope.macos.process-files';
  return null;
}

test('native sidecar resolver prefers explicit executable then repository release binary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harnesscope-sidecar-'));
  const explicit = join(dir, process.platform === 'win32' ? 'custom.exe' : 'custom');
  writeFileSync(explicit, 'fixture');

  assert.equal(
    resolveNativeCollectorBinary({
      platform: process.platform,
      arch: process.arch,
      env: { HARNESSCOPE_COLLECTOR_BIN: explicit },
      cwd: dir,
    }),
    resolve(explicit),
  );

  const releaseDir = join(dir, 'target', 'release');
  mkdirSync(releaseDir, { recursive: true });
  const fallback = join(releaseDir, process.platform === 'win32'
    ? 'harnesscope-native-collector.exe'
    : 'harnesscope-native-collector');
  writeFileSync(fallback, 'fixture');
  assert.equal(
    resolveNativeCollectorBinary({ platform: process.platform, arch: process.arch, env: {}, cwd: dir }),
    resolve(fallback),
  );
  assert.equal(existsSync(fallback), true);
});

test('native sidecar resolver fails deterministically with build guidance', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harnesscope-sidecar-missing-'));
  assert.throws(
    () => resolveNativeCollectorBinary({ platform: process.platform, arch: process.arch, env: {}, cwd: dir }),
    (error) => error?.code === 'COLLECTOR_NOT_FOUND'
      && /npm run collector:build/.test(error.message)
      && /harnesscope-native-collector/.test(error.message),
  );
});

test('collector list and describe expose only the current platform manifest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'harnesscope-cli-list-'));
  const db = join(dir, 'workspace.sqlite');
  const listOutput = captureIo();
  assert.equal(await runCli(['--db', db, 'collector', 'list', '--json'], listOutput.io), 0);
  const manifests = JSON.parse(listOutput.stdout());
  const expectedId = platformCollectorId();
  if (expectedId) {
    assert.equal(manifests.length, 1);
    assert.equal(manifests[0].id, expectedId);
    assert.equal(manifests[0].sdkVersion, '1');
  } else {
    assert.deepEqual(manifests, []);
  }

  const describeOutput = captureIo();
  assert.equal(
    await runCli(['--db', db, 'collector', 'describe', expectedId ?? 'harnesscope.linux.process-files', '--json'], describeOutput.io),
    0,
  );
  const described = JSON.parse(describeOutput.stdout());
  assert.equal(described?.id ?? null, expectedId);
});

test('collector execution checks session existence before resolving or spawning a collector', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'harnesscope-cli-session-'));
  const db = join(dir, 'workspace.sqlite');
  const output = captureIo();
  await assert.rejects(
    runCli([
      '--db', db,
      'collector', 'external',
      '--command', process.execPath,
      '--session', 'missing-session',
      '--json',
      '--', process.execPath, '--version',
    ], output.io),
    /Session not found: missing-session/,
  );
});

test('collector CLI preserves repeated path parsing and shell-free host execution contracts', () => {
  const cliSource = readFileSync(join(root, 'src', 'cli.mjs'), 'utf8');
  const hostSource = readFileSync(join(root, 'src', 'collectors', 'host.mjs'), 'utf8');
  assert.match(cliSource, /pullOpts\(args, ['"]--path['"]\)/);
  assert.match(hostSource, /shell:\s*false/);
  assert.doesNotMatch(hostSource, /shell:\s*true/);
});

test('collector build helper is the exact pinned source-build command', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(
    pkg.scripts['collector:build'],
    'cargo build -p harnesscope-collectors --bin harnesscope-native-collector --release',
  );
});
