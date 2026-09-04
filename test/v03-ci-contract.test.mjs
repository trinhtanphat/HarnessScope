import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

const job = (name) => {
  const start = workflow.indexOf(`  ${name}:`);
  assert.ok(start >= 0, `missing CI job ${name}`);
  const rest = workflow.slice(start + 2);
  const next = rest.search(/\n  [A-Za-z0-9_-]+:\n/);
  return next >= 0 ? rest.slice(0, next) : rest;
};

test('v0.3 CI separates portable Node, cross-platform Rust, parity, and native Tauri gates', () => {
  for (const name of ['node-test', 'rust-core', 'parity', 'tauri-windows', 'tauri-macos']) job(name);

  const node = job('node-test');
  assert.match(node, /matrix:[\s\S]*os:\s*\[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(node, /npm test/);

  const rust = job('rust-core');
  assert.match(rust, /matrix:[\s\S]*os:\s*\[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(rust, /cargo \+1\.98\.1 fmt --all -- --check/);
  assert.match(rust, /cargo \+1\.98\.1 clippy --workspace --all-targets -- -D warnings/);
  assert.match(rust, /cargo \+1\.98\.1 test --workspace/);
  assert.match(rust, /cargo \+1\.98\.1 check -p harnesscope-tauri/);

  const parity = job('parity');
  assert.match(parity, /node scripts\/run-parity\.mjs/);
  for (const capability of ['model-roundtrip', 'redaction', 'store', 'inference', 'compare', 'imports', 'export']) {
    assert.match(readFileSync(new URL('../scripts/run-parity.mjs', import.meta.url), 'utf8'), new RegExp(capability));
  }
});

test('native Tauri jobs depend on portable/Rust/parity gates and publish normalized v0.3 artifacts', () => {
  const windows = job('tauri-windows');
  assert.match(windows, /needs:\s*\[node-test, rust-core, parity\]/);
  assert.match(windows, /runs-on:\s*windows-latest/);
  assert.match(windows, /npm run tauri:win/);
  assert.match(windows, /HarnessScope-0\.3\.0-windows-x64-Setup\.exe/);
  assert.match(windows, /HarnessScope-0\.3\.0-windows-x64\.msi/);
  assert.match(windows, /HarnessScope-0\.3\.0-windows-x64-portable\.zip/);
  assert.match(windows, /name:\s*HarnessScope-0\.3\.0-windows-x64/);

  const mac = job('tauri-macos');
  assert.match(mac, /needs:\s*\[node-test, rust-core, parity\]/);
  assert.match(mac, /runs-on:\s*macos-latest/);
  assert.match(mac, /x86_64-apple-darwin/);
  assert.match(mac, /aarch64-apple-darwin/);
  assert.match(mac, /npm run tauri:mac/);
  assert.match(mac, /HarnessScope-0\.3\.0-macos-universal\.dmg/);
  assert.match(mac, /HarnessScope-0\.3\.0-macos-universal\.app\.zip/);
  assert.match(mac, /name:\s*HarnessScope-0\.3\.0-macos-universal/);
});

test('CI remains a push/pull-request verification workflow and never publishes a release', () => {
  assert.match(workflow, /push:/);
  assert.match(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.doesNotMatch(workflow, /gh release|softprops\/action-gh-release|create-release/i);
});
