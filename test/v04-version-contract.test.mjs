import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const json = (path) => JSON.parse(read(path));
const releaseV03 = new URL('../.github/workflows/release-v0.3.0.yml', import.meta.url);
const releaseV04 = new URL('../.github/workflows/release-v0.4.0.yml', import.meta.url);

const expectedAssets = [
  'HarnessScope-0.4.0-windows-x64-Setup.exe',
  'HarnessScope-0.4.0-windows-x64.msi',
  'HarnessScope-0.4.0-windows-x64-portable.zip',
  'HarnessScope-0.4.0-macos-universal.dmg',
  'HarnessScope-0.4.0-macos-universal.app.zip',
  'HarnessScope-0.4.0-source.zip',
  'SHA256SUMS.txt',
];

test('all product and native package versions are exactly 0.4.0', () => {
  assert.equal(json('package.json').version, '0.4.0');
  const lock = json('package-lock.json');
  assert.equal(lock.version, '0.4.0');
  assert.equal(lock.packages?.['']?.version, '0.4.0');

  for (const path of [
    'crates/harnesscope-core/Cargo.toml',
    'crates/harnesscope-parity/Cargo.toml',
    'crates/harnesscope-collector-sdk/Cargo.toml',
    'crates/harnesscope-collectors/Cargo.toml',
    'apps/tauri/src-tauri/Cargo.toml',
  ]) {
    assert.match(read(path), /^version\s*=\s*"0\.4\.0"$/m, `${path} is not 0.4.0`);
  }
  assert.equal(json('apps/tauri/src-tauri/tauri.conf.json').version, '0.4.0');
});

test('v0.4 release workflow replaces the old v0.3 publisher', () => {
  assert.equal(existsSync(releaseV03), false, 'stale release-v0.3.0 workflow must be removed');
  assert.equal(existsSync(releaseV04), true, 'release-v0.4.0 workflow is missing');
  const workflow = readFileSync(releaseV04, 'utf8');
  assert.match(workflow, /^name:\s*release-v0\.4\.0$/m);
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows:\s*\["ci"\]/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion\s*==\s*'success'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch\s*==\s*'main'/);
  assert.match(workflow, /TARGET_SHA:\s*\$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  for (const asset of expectedAssets) assert.match(workflow, new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('CI and normalization helpers use only v0.4 native artifact names', () => {
  const ci = read('.github/workflows/ci.yml');
  const windows = read('scripts/package-windows-portable.ps1');
  const macos = read('scripts/package-macos-app.sh');
  for (const asset of expectedAssets.slice(0, 5)) {
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.ok(new RegExp(escaped).test(`${ci}\n${windows}\n${macos}`), `missing ${asset}`);
  }
  assert.doesNotMatch(`${ci}\n${windows}\n${macos}`, /HarnessScope-0\.3\.0-(windows|macos)/);
});

test('v0.4 release contract retains both native collector gates', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /^  collector-linux:/m);
  assert.match(ci, /^  collector-macos:/m);
  assert.match(ci, /node scripts\/run-native-collector-smoke\.mjs/);
});
