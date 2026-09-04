import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const workflowUrl = new URL('../.github/workflows/release-v0.2.0.yml', import.meta.url);
const oldWorkflowUrl = new URL('../.github/workflows/release-v0.1.0.yml', import.meta.url);
const workflow = readFileSync(workflowUrl, 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('v0.2 release is gated by successful main CI and exact triggering SHA', () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows:\s*\[?["']?ci["']?\]?/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion\s*==\s*['"]success['"]/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch\s*==\s*['"]main['"]/);
  assert.match(workflow, /TARGET_SHA:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}/);
  assert.ok((workflow.match(/ref:\s*\$\{\{\s*env\.TARGET_SHA\s*\}\}/g) || []).length >= 3, 'every release job must checkout the triggering SHA');
  assert.match(workflow, /0\.2\.0/);
  assert.match(workflow, /package\.json/);
});

test('release rebuilds independent native packages before publication', () => {
  assert.match(workflow, /package-windows:/);
  assert.match(workflow, /package-macos:/);
  assert.match(workflow, /release:/);
  assert.match(workflow, /needs:\s*\[package-windows,\s*package-macos\]/);
  assert.match(workflow, /npm run desktop:win/);
  assert.match(workflow, /npm run desktop:mac/);
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY:\s*["']?false["']?/);
  assert.ok((workflow.match(/actions\/upload-artifact@v4/g) || []).length >= 2);
  assert.ok((workflow.match(/actions\/download-artifact@v4/g) || []).length >= 2);
});

test('release has idempotent tag guard, checksums, and exact six public assets', () => {
  assert.match(workflow, /refs\/tags\/\$\{?VERSION\}?|refs\/tags\/\$VERSION|git rev-parse|git ls-remote/);
  assert.match(workflow, /sha256sum/);
  for (const asset of [
    'HarnessScope-0.2.0-Setup.exe',
    'HarnessScope-0.2.0-windows-portable.zip',
    'HarnessScope-0.2.0-macos-universal.dmg',
    'HarnessScope-0.2.0-macos-universal.app.zip',
    'HarnessScope-0.2.0-source.zip',
    'SHA256SUMS.txt'
  ]) assert.match(workflow, new RegExp(asset.replaceAll('.', '\\.')));
  assert.match(workflow, /gh release create/);
});

test('v0.1 release workflow is retired and README documents safe unsigned launch guidance', () => {
  assert.equal(existsSync(oldWorkflowUrl), false);
  assert.match(readme, /SmartScreen/i);
  assert.match(readme, /Control-click/i);
  assert.match(readme, /unsigned/i);
  assert.doesNotMatch(readme, /spctl\s+--master-disable|xattr\s+-cr|disable Gatekeeper/i);
});
