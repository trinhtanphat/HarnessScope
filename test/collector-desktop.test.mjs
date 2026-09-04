import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const expectedActions = ['list', 'describe', 'start', 'stop', 'status'];

test('Electron exposes exactly the five safe collector actions', () => {
  const channels = read('apps/desktop/channels.mjs');
  const bridge = read('apps/desktop/bridge.mjs');
  const preload = read('apps/desktop/preload.cjs');
  const ipc = read('apps/desktop/ipc.mjs');

  for (const action of expectedActions) {
    const upper = action.toUpperCase();
    assert.match(channels, new RegExp(`COLLECTOR_${upper}`));
    assert.match(preload, new RegExp(`COLLECTOR_${upper}`));
  }
  assert.match(bridge, /collector:\s*Object\.freeze/);
  assert.match(ipc, /services\.collectorList/);
  assert.match(ipc, /services\.collectorDescribe/);
  assert.match(ipc, /services\.collectorStart/);
  assert.match(ipc, /services\.collectorStop/);
  assert.match(ipc, /services\.collectorStatus/);

  assert.doesNotMatch(preload, /child_process|node:fs|node:child_process|@tauri-apps\/plugin-shell|ipcRenderer\s*[,}]/);
});

test('desktop validators bound collector target and explicit paths', () => {
  const validators = read('apps/desktop/validators.mjs');
  assert.match(validators, /validateCollectorStartRequest/);
  assert.match(validators, /INVALID_COLLECTOR_REQUEST/);
  assert.match(validators, /paths/);
  assert.match(validators, /target/);
  assert.match(validators, /hashFiles/);
});

test('Tauri owns collectors in Rust and exposes matching command names only', () => {
  const state = read('apps/tauri/src-tauri/src/state.rs');
  const commands = read('apps/tauri/src-tauri/src/commands.rs');
  const main = read('apps/tauri/src-tauri/src/main.rs');
  const cargo = read('apps/tauri/src-tauri/Cargo.toml');
  const coreServices = read('crates/harnesscope-core/src/services.rs');

  assert.match(coreServices, /collector_append_event/);
  assert.match(state, /HashMap/);
  assert.match(state, /CollectorHandle/);
  assert.match(cargo, /harnesscope-collectors/);
  for (const action of expectedActions) {
    assert.match(commands, new RegExp(`fn collector_${action}\\b`));
    assert.match(main, new RegExp(`commands::collector_${action}`));
  }
  assert.doesNotMatch(commands, /tauri_plugin_shell|std::process::Command|Command::new/);
});

test('shared renderer has a bounded Collector panel and no raw native handles', () => {
  const tauriBridge = read('ui/tauri-bridge.js');
  const dataClient = read('ui/data-client.js');
  const html = read('ui/index.html');
  const app = read('ui/app.js');

  for (const action of expectedActions) {
    assert.match(tauriBridge, new RegExp(`collector_${action}`));
  }
  assert.match(dataClient, /collector/);
  assert.match(html, /collector-panel/);
  assert.match(html, /collector-start/);
  assert.match(html, /collector-stop/);
  assert.match(app, /collector\.start/);
  assert.match(app, /collector\.stop/);

  const combined = `${tauriBridge}\n${dataClient}\n${app}`;
  assert.doesNotMatch(combined, /child_process|ipcRenderer|fs\.watch|RecommendedWatcher|rawWatcher|rawProcess/);
});
