import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const icons = [
  'icons/32x32.png',
  'icons/128x128.png',
  'icons/128x128@2x.png',
  'icons/icon.png',
  'icons/icon.icns',
  'icons/icon.ico'
];

const required = [
  'apps/tauri/README.md',
  'apps/tauri/src-tauri/Cargo.toml',
  'apps/tauri/src-tauri/build.rs',
  'apps/tauri/src-tauri/tauri.conf.json',
  'apps/tauri/src-tauri/capabilities/main.json',
  'apps/tauri/src-tauri/src/main.rs',
  'apps/tauri/src-tauri/src/commands.rs',
  'apps/tauri/src-tauri/src/state.rs',
  'apps/tauri/src-tauri/src/errors.rs',
  ...icons.map((icon) => `apps/tauri/src-tauri/${icon}`),
  'ui/tauri-bridge.js'
];

const commands = [
  'app_info', 'workspace_info', 'session_list', 'session_create', 'timeline_get',
  'inference_run', 'compare_run', 'import_har', 'import_procmon', 'import_jsonl',
  'launch_run', 'export_run', 'dialog_pick_directory', 'dialog_pick_file'
];

test('v0.3 Tauri shell files, valid icon contract, and pinned least-privilege contract exist', () => {
  for (const path of required) assert.equal(existsSync(resolve(root, path)), true, `missing ${path}`);

  const workspace = read('Cargo.toml');
  assert.match(workspace, /apps\/tauri\/src-tauri/);

  const cargo = read('apps/tauri/src-tauri/Cargo.toml');
  assert.match(cargo, /name\s*=\s*"harnesscope-tauri"/);
  assert.match(cargo, /tauri\s*=\s*"=2\.11\.5"/);
  assert.match(cargo, /tauri-build\s*=\s*"=2\.6\.3"/);
  assert.match(cargo, /tauri-plugin-dialog\s*=\s*"=2\.7\.3"/);
  assert.doesNotMatch(cargo, /tauri-plugin-(shell|fs)/);

  const config = JSON.parse(read('apps/tauri/src-tauri/tauri.conf.json'));
  assert.equal(config.productName, 'HarnessScope');
  assert.equal(config.identifier, 'com.trinhtanphat.harnesscope');
  assert.equal(config.version, '0.3.0');
  assert.equal(config.build.frontendDist, '../../../ui');
  assert.equal(config.app.withGlobalTauri, true);
  assert.deepEqual(config.bundle.targets, ['nsis', 'msi', 'dmg', 'app']);
  assert.deepEqual(config.bundle.icon, icons);
  assert.match(config.app.security.csp, /connect-src 'self' ipc: http:\/\/ipc\.localhost/);

  const capabilities = read('apps/tauri/src-tauri/capabilities/main.json');
  assert.doesNotMatch(capabilities, /shell|fs:/i);
  assert.match(capabilities, /dialog:/i);

  const rust = [read('apps/tauri/src-tauri/src/main.rs'), read('apps/tauri/src-tauri/src/commands.rs')].join('\n');
  for (const command of commands) assert.match(rust, new RegExp(`\\b${command}\\b`), `missing command ${command}`);
});

test('v0.3 package scripts preserve Electron fallback while adding exact Tauri build entrypoints', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.desktop, 'electron .');
  assert.equal(pkg.scripts.tauri, 'tauri');
  assert.equal(pkg.scripts['tauri:dev'], 'tauri dev --config apps/tauri/src-tauri/tauri.conf.json');
  assert.equal(pkg.scripts['tauri:win'], 'tauri build --config apps/tauri/src-tauri/tauri.conf.json --target x86_64-pc-windows-msvc --bundles nsis,msi');
  assert.equal(pkg.scripts['tauri:mac'], 'tauri build --config apps/tauri/src-tauri/tauri.conf.json --target universal-apple-darwin --bundles dmg,app');
});

test('shared renderer loads Tauri bridge before the data client', () => {
  const html = read('ui/index.html');
  const tauri = html.indexOf('./tauri-bridge.js');
  const data = html.indexOf('./data-client.js');
  assert.ok(tauri >= 0, 'Tauri bridge script missing');
  assert.ok(data > tauri, 'Tauri bridge must load before data client');
});
