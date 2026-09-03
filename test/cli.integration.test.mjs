import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = join(root, 'bin', 'harnesscope.mjs');
function run(args) {
  const r = spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding:'utf8', env:{...process.env, NODE_NO_WARNINGS:'1'} });
  if (r.status !== 0) throw new Error(`CLI failed (${r.status}): ${r.error?.message || r.stderr || r.stdout}`);
  return r.stdout.trim();
}

test('CLI creates session, launches synthetic agent, infers findings, prints timeline and exports spec', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harnesscope-cli-'));
  const db = join(dir, 'workspace.sqlite');
  const session = JSON.parse(run(['--db', db, 'session', 'new', '--name', 'fixture', '--mode', 'desktop', '--json']));
  assert.ok(session.id);
  const launch = JSON.parse(run(['--db', db, 'launch', '--session', session.id, '--json', '--', process.execPath, 'fixtures/dummy-agent.mjs']));
  assert.equal(launch.exitCode, 0);
  assert.ok(launch.eventsCaptured >= 10);
  const inference = JSON.parse(run(['--db', db, 'infer', '--session', session.id, '--json']));
  assert.ok(inference.findings.some((f) => f.category === 'skill_loading'));
  assert.ok(inference.findings.some((f) => f.category === 'permission_gate'));
  const timeline = JSON.parse(run(['--db', db, 'timeline', '--session', session.id, '--json']));
  assert.ok(timeline.events.some((e) => e.kind === 'ProcessStarted'));
  assert.ok(timeline.events.some((e) => e.kind === 'ProcessExited'));
  const out = join(dir, 'spec');
  run(['--db', db, 'export', '--session', session.id, '--out', out, '--json']);
  assert.equal(existsSync(join(out, 'harness-spec.md')), true);
  const text = readFileSync(join(out, 'harness-spec.md'), 'utf8');
  assert.match(text, /Progressive instruction\/skill loading/);
});
