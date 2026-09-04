import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const enabled = process.env.HARNESSCOPE_RUST_PARITY === '1';
const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = fileURLToPath(new URL('../fixtures/parity/compare.json', import.meta.url));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, `${command} failed:\n${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

test('Node and Rust comparison produce identical canonical diff', { skip: !enabled }, () => {
  const node = run(process.execPath, ['scripts/parity-node.mjs', 'compare', fixture]);
  const rust = run('cargo', ['+1.98.1', 'run', '-q', '-p', 'harnesscope-parity', '--', 'compare', fixture]);
  assert.deepEqual(rust, node);
  assert.deepEqual(rust.sharedToolNames, ['read']);
});
