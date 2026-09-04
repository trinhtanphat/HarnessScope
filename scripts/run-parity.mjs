#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const parityEnv = { ...process.env, HARNESSCOPE_RUST_PARITY: '1', NODE_NO_WARNINGS: '1' };

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: false, env });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout.trim();
}

function json(command, args) {
  return JSON.parse(run(command, args, parityEnv));
}

console.log('[parity] model-roundtrip');
const modelFixture = fileURLToPath(new URL('../fixtures/parity/model-roundtrip.json', import.meta.url));
const nodeModel = json(process.execPath, ['scripts/parity-node.mjs', 'model-roundtrip', modelFixture]);
const rustModel = json('cargo', ['+1.98.1', 'run', '-q', '-p', 'harnesscope-parity', '--', 'model-roundtrip', modelFixture]);
assert.deepEqual(rustModel, nodeModel);

console.log('[parity] redaction');
run(process.execPath, ['--test', 'test/v03-parity-redaction.test.mjs'], parityEnv);

console.log('[parity] store');
run(process.execPath, ['--test', 'test/v03-store-compat.test.mjs'], parityEnv);
run('cargo', ['+1.98.1', 'test', '-q', '-p', 'harnesscope-core', '--test', 'store'], parityEnv);

console.log('[parity] inference');
run(process.execPath, ['--test', 'test/v03-parity-inference.test.mjs'], parityEnv);

console.log('[parity] compare');
run(process.execPath, ['--test', 'test/v03-parity-compare.test.mjs'], parityEnv);

console.log('[parity] imports');
console.log('[parity] export');
run(process.execPath, ['--test', 'test/v03-parity-import-export.test.mjs'], parityEnv);

console.log('[parity] all semantic gates passed');
