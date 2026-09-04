import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const toolchain = readFileSync(new URL('../rust-toolchain.toml', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../Cargo.toml', import.meta.url), 'utf8');
const tauriCargo = readFileSync(new URL('../apps/tauri/src-tauri/Cargo.toml', import.meta.url), 'utf8');

test('v0.4 pins Rust/Tauri toolchain while preserving Electron fallback and collector workspace members', () => {
  assert.equal(pkg.version, '0.4.0');
  assert.equal(pkg.devDependencies?.['@tauri-apps/cli'], '2.11.4');
  assert.equal(pkg.devDependencies?.electron, '44.1.0');
  assert.equal(pkg.devDependencies?.['electron-builder'], '26.15.3');
  assert.equal(pkg.scripts?.desktop, 'electron .');
  assert.match(toolchain, /channel\s*=\s*"1\.98\.1"/);
  assert.match(toolchain, /components\s*=\s*\[[^\]]*"rustfmt"[^\]]*"clippy"[^\]]*\]/s);
  for (const member of [
    'crates/harnesscope-core',
    'crates/harnesscope-parity',
    'crates/harnesscope-collector-sdk',
    'crates/harnesscope-collectors',
    'apps/tauri/src-tauri',
  ]) assert.match(workspace, new RegExp(member.replaceAll('/', '\\/')));
  assert.match(tauriCargo, /name\s*=\s*"harnesscope-tauri"/);
  assert.match(tauriCargo, /^version\s*=\s*"0\.4\.0"$/m);
  assert.match(tauriCargo, /tauri\s*=\s*"=2\.11\.5"/);
  assert.match(tauriCargo, /tauri-build\s*=\s*"=2\.6\.3"/);
  assert.match(tauriCargo, /tauri-plugin-dialog\s*=\s*"=2\.7\.3"/);
});
