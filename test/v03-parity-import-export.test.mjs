import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const enabled = process.env.HARNESSCOPE_RUST_PARITY === '1';
const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, `${command} failed:\n${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function runPair(caseName, fixturePath) {
  return {
    node: run(process.execPath, ['scripts/parity-node.mjs', caseName, fixturePath]),
    rust: run('cargo', ['+1.98.1', 'run', '-q', '-p', 'harnesscope-parity', '--', caseName, fixturePath])
  };
}

function normalizeHar(events) {
  const correlation = new Map();
  let next = 1;
  return events.map((event) => {
    const key = event.correlationId;
    if (key && !correlation.has(key)) correlation.set(key, `har-${next++}`);
    return { ...event, correlationId: key ? correlation.get(key) : key };
  });
}

test('Node and Rust HAR importers are canonically equal except generated correlation UUIDs', { skip: !enabled }, () => {
  const { node, rust } = runPair('imports-har', fixture('sample.har'));
  assert.deepEqual(normalizeHar(rust), normalizeHar(node));
});

test('Node and Rust Procmon importers are canonically equal', { skip: !enabled }, () => {
  const { node, rust } = runPair('imports-procmon', fixture('sample-procmon.csv'));
  assert.deepEqual(rust, node);
});

test('Node and Rust JSONL importers are canonically equal', { skip: !enabled }, () => {
  const { node, rust } = runPair('imports-jsonl', fixture('sample.jsonl'));
  assert.deepEqual(rust, node);
});

test('Node and Rust exporters produce exact deterministic markdown JSON and tool schemas', { skip: !enabled }, () => {
  const workspace = fixture('v02-workspace/workspace.sqlite');
  const { node, rust } = runPair('export', workspace);
  assert.deepEqual(rust, node);
  assert.equal(rust.spec.includes('must-not-export'), false);
  assert.equal(rust.markdown.includes('must-not-export'), false);
  assert.equal(Object.values(rust.toolSchemas).join('\n').includes('must-not-export'), false);
});
