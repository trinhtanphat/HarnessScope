import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const path = new URL('../.github/workflows/release-v0.4.0.yml', import.meta.url);
const workflow = existsSync(path) ? readFileSync(path, 'utf8') : '';
const assets = [
  'HarnessScope-0.4.0-windows-x64-Setup.exe',
  'HarnessScope-0.4.0-windows-x64.msi',
  'HarnessScope-0.4.0-windows-x64-portable.zip',
  'HarnessScope-0.4.0-macos-universal.dmg',
  'HarnessScope-0.4.0-macos-universal.app.zip',
  'HarnessScope-0.4.0-source.zip',
  'SHA256SUMS.txt',
];

test('v0.4 release workflow exists and is bound to successful main CI exact head', () => {
  assert.equal(existsSync(path), true, 'missing release-v0.4.0.yml');
  assert.match(workflow, /^name:\s*release-v0\.4\.0$/m);
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows:\s*\["ci"\]/);
  assert.match(workflow, /types:\s*\[completed\]/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion\s*==\s*'success'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch\s*==\s*'main'/);
  assert.match(workflow, /TARGET_SHA:\s*\$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(workflow, /ref:\s*\$\{\{ env\.TARGET_SHA \}\}/);
  assert.match(workflow, /git rev-parse HEAD/);
});

test('v0.4 package jobs independently verify collector SDK and native collector runtime', () => {
  assert.match(workflow, /package-windows:[\s\S]*cargo \+1\.98\.1 (?:clippy|test) -p harnesscope-collector-sdk/);
  assert.match(workflow, /package-windows:[\s\S]*cargo \+1\.98\.1 (?:clippy|test) -p harnesscope-collectors/);
  assert.match(workflow, /package-macos:[\s\S]*cargo \+1\.98\.1 (?:clippy|test) -p harnesscope-collector-sdk/);
  assert.match(workflow, /package-macos:[\s\S]*cargo \+1\.98\.1 (?:clippy|test) -p harnesscope-collectors/);
});

test('v0.4 release publishes exactly the seven normalized asset names and checksums', () => {
  for (const asset of assets) {
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(workflow, new RegExp(escaped), `missing ${asset}`);
  }
  assert.match(workflow, /sha256sum/);
  assert.match(workflow, /SHA256SUMS\.txt/);
});

test('existing v0.4 tag is fail-closed and cannot be rebound to another SHA', () => {
  assert.match(workflow, /git rev-parse -q --verify "refs\/tags\/\$VERSION"/);
  assert.match(workflow, /tag_sha="\$\(git rev-list -n 1 "\$VERSION"\)"/);
  assert.match(workflow, /if \[ "\$tag_sha" != "\$TARGET_SHA" \]; then/);
  assert.match(workflow, /exit 1/);
  assert.match(workflow, /gh release view "\$VERSION" --json assets/);
});

test('release creation is non-draft/non-prerelease by default and verifies published invariants', () => {
  assert.match(workflow, /gh release create "\$VERSION"/);
  assert.doesNotMatch(workflow, /--draft|--prerelease/);
  assert.match(workflow, /--json isDraft/);
  assert.match(workflow, /--json isPrerelease/);
  assert.match(workflow, /git rev-list -n 1 "\$VERSION"/);
});
