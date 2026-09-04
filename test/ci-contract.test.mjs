import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('CI keeps portable test matrix and native desktop gates while adding Rust verification', () => {
  assert.match(workflow, /matrix:\s*[\s\S]*os:\s*\[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(workflow, /rust-core:/);
  assert.match(workflow, /cargo \+1\.98\.1 fmt/);
  assert.match(workflow, /cargo \+1\.98\.1 clippy/);
  assert.match(workflow, /cargo \+1\.98\.1 test/);
  assert.match(workflow, /desktop-windows:/);
  assert.match(workflow, /desktop-macos:/);
  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(workflow, /runs-on:\s*macos-latest/);
});

test('Electron fallback CI installs dependencies, tests before packaging, validates v0.3 artifacts, and uploads them', () => {
  assert.ok((workflow.match(/npm install/g) || []).length >= 2, 'both desktop jobs must install Electron dependencies');
  assert.ok((workflow.match(/npm test/g) || []).length >= 3, 'portable matrix and desktop jobs must test');
  assert.match(workflow, /npm run desktop:win/);
  assert.match(workflow, /npm run desktop:mac/);
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY:\s*["']?false["']?/);
  assert.match(workflow, /HarnessScope-0\.3\.0-Setup\.exe/);
  assert.match(workflow, /HarnessScope-0\.3\.0-windows-portable\.zip/);
  assert.match(workflow, /HarnessScope-0\.3\.0-macos-universal\.dmg/);
  assert.match(workflow, /HarnessScope-0\.3\.0-macos-universal\.zip/);
  assert.ok((workflow.match(/actions\/upload-artifact@v4/g) || []).length >= 2, 'both desktop jobs upload artifacts');
});
