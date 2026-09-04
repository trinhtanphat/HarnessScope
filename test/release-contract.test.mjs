import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const workflowUrl = new URL('../.github/workflows/release-v0.3.0.yml', import.meta.url);
const oldWorkflowUrl = new URL('../.github/workflows/release-v0.2.0.yml', import.meta.url);
const workflow = existsSync(workflowUrl) ? readFileSync(workflowUrl, 'utf8') : '';
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

const assets = [
  'HarnessScope-0.3.0-windows-x64-Setup.exe',
  'HarnessScope-0.3.0-windows-x64.msi',
  'HarnessScope-0.3.0-windows-x64-portable.zip',
  'HarnessScope-0.3.0-macos-universal.dmg',
  'HarnessScope-0.3.0-macos-universal.app.zip',
  'HarnessScope-0.3.0-source.zip',
  'SHA256SUMS.txt'
];

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('v0.3 release is gated by successful main CI and exact triggering SHA in every release job', () => {
  assert.equal(existsSync(workflowUrl), true, 'missing release-v0.3.0.yml');
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows:\s*\[?["']?ci["']?\]?/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion\s*==\s*['"]success['"]/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch\s*==\s*['"]main['"]/);
  assert.match(workflow, /TARGET_SHA:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}/);
  assert.ok((workflow.match(/ref:\s*\$\{\{\s*env\.TARGET_SHA\s*\}\}/g) || []).length >= 3,
    'every release job must checkout the triggering SHA');
  assert.ok((workflow.match(/git rev-parse HEAD/g) || []).length >= 3,
    'every release job must verify checkout SHA');
  assert.match(workflow, /0\.3\.0/);
});

test('release independently rebuilds verified Tauri packages on native Windows and macOS runners', () => {
  assert.match(workflow, /package-windows:/);
  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /cargo \+1\.98\.1 fmt --all -- --check/);
  assert.match(workflow, /cargo \+1\.98\.1 clippy/);
  assert.match(workflow, /cargo \+1\.98\.1 test/);
  assert.match(workflow, /node scripts\/run-parity\.mjs/);
  assert.match(workflow, /npm run tauri:win/);
  assert.match(workflow, /scripts\/package-windows-portable\.ps1/);

  assert.match(workflow, /package-macos:/);
  assert.match(workflow, /runs-on:\s*macos-latest/);
  assert.match(workflow, /npm run tauri:mac/);
  assert.match(workflow, /scripts\/package-macos-app\.sh/);
  assert.ok((workflow.match(/actions\/upload-artifact@v4/g) || []).length >= 2);
  assert.ok((workflow.match(/actions\/download-artifact@v4/g) || []).length >= 2);
});

test('release is fail-closed, idempotent, checksum-verified, and publishes exactly the seven v0.3 assets', () => {
  assert.match(workflow, /release:/);
  assert.match(workflow, /needs:\s*\[package-windows,\s*package-macos\]/);
  assert.match(workflow, /git fetch --tags/);
  assert.match(workflow, /git rev-list -n 1/);
  assert.match(workflow, /gh release view/);
  assert.match(workflow, /sha256sum/);
  assert.match(workflow, /git archive/);
  for (const asset of assets) assert.match(workflow, new RegExp(escape(asset)));
  assert.match(workflow, /gh release create/);
});

test('v0.2 release workflow is retired and README makes Tauri v0.3 preferred while preserving safe fallbacks', () => {
  assert.equal(existsSync(oldWorkflowUrl), false, 'v0.2 release workflow must be retired');
  assert.match(readme, /Tauri/i);
  assert.match(readme, /preferred/i);
  assert.match(readme, /Electron/i);
  assert.match(readme, /fallback/i);
  assert.match(readme, /Node\.js|Node CLI/i);
  for (const asset of assets) assert.match(readme, new RegExp(escape(asset)));
  assert.match(readme, /SmartScreen/i);
  assert.match(readme, /Control-click/i);
  assert.match(readme, /unsigned/i);
  assert.doesNotMatch(readme, /spctl\s+--master-disable|xattr\s+-cr|disable Gatekeeper/i);
});
