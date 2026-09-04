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

test('v0.3 CI separates portable Node, cross-platform Rust, parity, and native Tauri gates', () => {
  for (const name of ['node-test', 'rust-core', 'parity', 'tauri-windows', 'tauri-macos']) job(name);

  const node = job('node-test');
  assert.match(node, /matrix:[\s\S]*os:\s*\[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(node, /npm ci/);
  assert.match(node, /npm test/);

  const rust = job('rust-core');
  assert.match(rust, /matrix:[\s\S]*os:\s*\[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(rust, /cargo \+1\.98\.1 fmt --all -- --check/);
  assert.match(rust, /cargo \+1\.98\.1 clippy --workspace --all-targets -- -D warnings/);
  assert.match(rust, /cargo \+1\.98\.1 test --workspace/);
  assert.match(rust, /cargo \+1\.98\.1 check -p harnesscope-tauri/);

  const parity = job('parity');
  assert.match(parity, /node scripts\/run-parity\.mjs/);
  const parityScript = readFileSync(new URL('../scripts/run-parity.mjs', import.meta.url), 'utf8');
  for (const capability of ['model-roundtrip', 'redaction', 'store', 'inference', 'compare', 'imports', 'export']) {
    assert.match(parityScript, new RegExp(capability));
  }
});

test('native Tauri jobs install exact targets, use npm ci, and package normalized v0.3 artifacts', () => {
  const windows = job('tauri-windows');
  assert.match(windows, /needs:\s*\[node-test, rust-core, parity\]/);
  assert.match(windows, /runs-on:\s*windows-latest/);
  assert.match(windows, /rustup target add --toolchain 1\.98\.1 x86_64-pc-windows-msvc/);
  assert.match(windows, /npm ci/);
  assert.match(windows, /npm run tauri:win/);
  assert.match(windows, /scripts\/package-windows-portable\.ps1/);
  assert.match(windows, /dist\/tauri\/HarnessScope-0\.3\.0-windows-x64-Setup\.exe/);
  assert.match(windows, /dist\/tauri\/HarnessScope-0\.3\.0-windows-x64\.msi/);
  assert.match(windows, /dist\/tauri\/HarnessScope-0\.3\.0-windows-x64-portable\.zip/);
  assert.match(windows, /name:\s*HarnessScope-0\.3\.0-windows-x64/);

  const mac = job('tauri-macos');
  assert.match(mac, /needs:\s*\[node-test, rust-core, parity\]/);
  assert.match(mac, /runs-on:\s*macos-latest/);
  assert.match(mac, /rustup target add --toolchain 1\.98\.1 aarch64-apple-darwin x86_64-apple-darwin/);
  assert.match(mac, /npm ci/);
  assert.match(mac, /npm run tauri:mac/);
  assert.match(mac, /scripts\/package-macos-app\.sh/);
  assert.match(mac, /dist\/tauri\/HarnessScope-0\.3\.0-macos-universal\.dmg/);
  assert.match(mac, /dist\/tauri\/HarnessScope-0\.3\.0-macos-universal\.app\.zip/);
  assert.match(mac, /name:\s*HarnessScope-0\.3\.0-macos-universal/);
});

test('portable package helpers include unsigned guidance and deterministic app archiving', () => {
  const windowsUrl = new URL('../scripts/package-windows-portable.ps1', import.meta.url);
  const macUrl = new URL('../scripts/package-macos-app.sh', import.meta.url);
  assert.ok(existsSync(windowsUrl), 'missing Windows portable package helper');
  assert.ok(existsSync(macUrl), 'missing macOS app package helper');

  const windows = readFileSync(windowsUrl, 'utf8');
  assert.match(windows, /README-UNSIGNED\.txt/);
  assert.match(windows, /Compress-Archive/);
  assert.match(windows, /HarnessScope-0\.3\.0-windows-x64-portable\.zip/);

  const mac = readFileSync(macUrl, 'utf8');
  assert.match(mac, /ditto -c -k --sequesterRsrc --keepParent/);
  assert.match(mac, /HarnessScope-0\.3\.0-macos-universal\.app\.zip/);
});

test('CI remains a push/pull-request verification workflow and never publishes a release', () => {
  assert.match(workflow, /push:/);
  assert.match(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.doesNotMatch(workflow, /gh release|softprops\/action-gh-release|create-release/i);
});
