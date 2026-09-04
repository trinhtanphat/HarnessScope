import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('CI has portable Node and Rust matrices plus parity and native Tauri package gates', () => {
  assert.match(workflow, /node-test:/);
  assert.match(workflow, /rust-core:/);
  assert.ok((workflow.match(/os:\s*\[ubuntu-latest, windows-latest, macos-latest\]/g) || []).length >= 2);
  assert.ok((workflow.match(/npm ci/g) || []).length >= 3, 'Node and both native package jobs must install from the lockfile');
  assert.match(workflow, /cargo \+1\.98\.1 fmt/);
  assert.match(workflow, /cargo \+1\.98\.1 clippy/);
  assert.match(workflow, /cargo \+1\.98\.1 test/);
  assert.match(workflow, /parity:/);
  assert.match(workflow, /tauri-windows:/);
  assert.match(workflow, /tauri-macos:/);
  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(workflow, /runs-on:\s*macos-latest/);
});

test('native CI validates normalized v0.3 Tauri artifacts and uploads both platform bundles', () => {
  assert.match(workflow, /npm run tauri:win/);
  assert.match(workflow, /npm run tauri:mac/);
  assert.match(workflow, /scripts\/package-windows-portable\.ps1/);
  assert.match(workflow, /scripts\/package-macos-app\.sh/);
  assert.match(workflow, /HarnessScope-0\.3\.0-windows-x64-Setup\.exe/);
  assert.match(workflow, /HarnessScope-0\.3\.0-windows-x64\.msi/);
  assert.match(workflow, /HarnessScope-0\.3\.0-windows-x64-portable\.zip/);
  assert.match(workflow, /HarnessScope-0\.3\.0-macos-universal\.dmg/);
  assert.match(workflow, /HarnessScope-0\.3\.0-macos-universal\.app\.zip/);
  assert.ok((workflow.match(/actions\/upload-artifact@v4/g) || []).length >= 2);
  assert.doesNotMatch(workflow, /npm run desktop:(win|mac)/);
});
