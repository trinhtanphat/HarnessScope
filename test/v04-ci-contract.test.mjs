import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const job = (name) => {
  const start = workflow.indexOf(`  ${name}:`);
  assert.ok(start >= 0, `missing CI job ${name}`);
  const rest = workflow.slice(start + 2);
  const next = rest.search(/\n  [A-Za-z0-9_-]+:\n/);
  return next >= 0 ? rest.slice(0, next) : rest;
};

test('v0.4 CI separates Node, Rust, native collectors, parity, and native Tauri gates', () => {
  for (const name of ['node-test', 'rust-core', 'collector-linux', 'collector-macos', 'parity', 'tauri-windows', 'tauri-macos']) job(name);
  const node = job('node-test');
  assert.match(node, /os:\s*\[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(node, /npm ci/);
  assert.match(node, /npm test/);

  const rust = job('rust-core');
  assert.match(rust, /os:\s*\[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(rust, /cargo \+1\.98\.1 fmt --all -- --check/);
  assert.match(rust, /cargo \+1\.98\.1 clippy -p harnesscope-core -p harnesscope-parity --all-targets -- -D warnings/);
  assert.match(rust, /cargo \+1\.98\.1 test -p harnesscope-core -p harnesscope-parity/);

  for (const name of ['collector-linux', 'collector-macos']) {
    const collector = job(name);
    assert.match(collector, /cargo \+1\.98\.1 test -p harnesscope-collector-sdk/);
    assert.match(collector, /cargo \+1\.98\.1 test -p harnesscope-collectors/);
    assert.match(collector, /node scripts\/run-native-collector-smoke\.mjs/);
  }

  const parity = job('parity');
  assert.match(parity, /needs:\s*\[node-test, rust-core, collector-linux, collector-macos\]/);
  assert.match(parity, /node scripts\/run-parity\.mjs/);
});

test('native Tauri jobs package normalized v0.4 artifacts after parity', () => {
  const windows = job('tauri-windows');
  assert.match(windows, /needs:\s*\[node-test, rust-core, parity\]/);
  assert.match(windows, /runs-on:\s*windows-latest/);
  assert.match(windows, /npm run tauri:win/);
  assert.match(windows, /scripts\/package-windows-portable\.ps1/);
  assert.match(windows, /HarnessScope-0\.4\.0-windows-x64-Setup\.exe/);
  assert.match(windows, /HarnessScope-0\.4\.0-windows-x64\.msi/);
  assert.match(windows, /HarnessScope-0\.4\.0-windows-x64-portable\.zip/);
  assert.match(windows, /name:\s*HarnessScope-0\.4\.0-windows-x64/);

  const mac = job('tauri-macos');
  assert.match(mac, /needs:\s*\[node-test, rust-core, parity\]/);
  assert.match(mac, /runs-on:\s*macos-latest/);
  assert.match(mac, /npm run tauri:mac/);
  assert.match(mac, /scripts\/package-macos-app\.sh/);
  assert.match(mac, /HarnessScope-0\.4\.0-macos-universal\.dmg/);
  assert.match(mac, /HarnessScope-0\.4\.0-macos-universal\.app\.zip/);
  assert.match(mac, /name:\s*HarnessScope-0\.4\.0-macos-universal/);
});

test('portable package helpers retain unsigned guidance and deterministic app archiving', () => {
  const windowsUrl = new URL('../scripts/package-windows-portable.ps1', import.meta.url);
  const macUrl = new URL('../scripts/package-macos-app.sh', import.meta.url);
  assert.equal(existsSync(windowsUrl), true);
  assert.equal(existsSync(macUrl), true);
  const windows = readFileSync(windowsUrl, 'utf8');
  assert.match(windows, /README-UNSIGNED\.txt/);
  assert.match(windows, /Compress-Archive/);
  assert.match(windows, /HarnessScope-0\.4\.0-windows-x64-portable\.zip/);
  const mac = readFileSync(macUrl, 'utf8');
  assert.match(mac, /ditto -c -k --sequesterRsrc --keepParent/);
  assert.match(mac, /HarnessScope-0\.4\.0-macos-universal\.app\.zip/);
});

test('CI remains verification-only and never publishes a release', () => {
  assert.match(workflow, /push:/);
  assert.match(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.doesNotMatch(workflow, /gh release|softprops\/action-gh-release|create-release/i);
});
