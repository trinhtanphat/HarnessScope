import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

function jobBlock(name, nextName) {
  const start = workflow.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `missing ${name} job`);
  const end = nextName ? workflow.indexOf(`  ${nextName}:`, start + 1) : workflow.length;
  return workflow.slice(start, end === -1 ? workflow.length : end);
}

test('v0.4 CI has dedicated Linux and macOS native collector gates', () => {
  const linux = jobBlock('collector-linux', 'collector-macos');
  const macos = jobBlock('collector-macos', 'parity');

  assert.match(linux, /runs-on:\s*ubuntu-latest/);
  assert.match(macos, /runs-on:\s*macos-latest/);
  for (const block of [linux, macos]) {
    assert.match(block, /cargo \+1\.98\.1 test -p harnesscope-collectors/);
    assert.match(block, /node scripts\/run-native-collector-smoke\.mjs/);
  }
});

test('parity and native Tauri packaging fail closed behind both collector gates', () => {
  const parity = jobBlock('parity', 'tauri-windows');
  assert.match(parity, /needs:\s*\[[^\]]*collector-linux[^\]]*collector-macos[^\]]*\]/s);

  const windows = jobBlock('tauri-windows', 'tauri-macos');
  const macos = jobBlock('tauri-macos');
  assert.match(windows, /needs:\s*\[[^\]]*parity[^\]]*\]/s);
  assert.match(macos, /needs:\s*\[[^\]]*parity[^\]]*\]/s);
});
