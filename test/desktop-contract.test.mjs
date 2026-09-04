import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createBridge } from '../apps/desktop/bridge.mjs';
import { CHANNELS } from '../apps/desktop/channels.mjs';
import { registerIpcHandlers } from '../apps/desktop/ipc.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('preload bridge exposes only the documented versioned desktop API', async () => {
  const calls = [];
  const api = createBridge(async (channel, ...args) => {
    calls.push([channel, ...args]);
    return { ok: true, value: channel };
  });

  assert.deepEqual(Object.keys(api).sort(), ['app','compare','dialog','export','import','inference','launch','session','timeline','workspace']);
  assert.deepEqual(Object.keys(api.app), ['info']);
  assert.deepEqual(Object.keys(api.workspace), ['info']);
  assert.deepEqual(Object.keys(api.session).sort(), ['create','list']);
  assert.deepEqual(Object.keys(api.timeline), ['get']);
  assert.deepEqual(Object.keys(api.inference), ['run']);
  assert.deepEqual(Object.keys(api.compare), ['run']);
  assert.deepEqual(Object.keys(api.import).sort(), ['har','jsonl','procmon']);
  assert.deepEqual(Object.keys(api.launch), ['run']);
  assert.deepEqual(Object.keys(api.export), ['run']);
  assert.deepEqual(Object.keys(api.dialog).sort(), ['pickDirectory','pickFile']);

  await api.session.create({ name: 'demo', mode: 'desktop' });
  assert.deepEqual(calls.at(-1), [CHANNELS.SESSION_CREATE, { name: 'demo', mode: 'desktop' }]);
});

test('IPC registration is an exact allowlist and normalizes handler results', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  const services = {
    appInfo: async () => ({ version: '0.2.0' }), workspaceInfo: async () => ({}),
    sessionList: async () => [], sessionCreate: async (value) => value,
    timelineGet: async () => ({}), inferenceRun: async () => ({}), compareRun: async () => ({}),
    importHar: async () => ({}), importProcmon: async () => ({}), importJsonl: async () => ({}),
    launchRun: async () => ({}), exportRun: async () => ({}),
    pickDirectory: async () => null, pickFile: async () => null
  };

  registerIpcHandlers({ ipcMain, services });
  assert.deepEqual([...handlers.keys()].sort(), Object.values(CHANNELS).sort());
  assert.deepEqual(await handlers.get(CHANNELS.APP_INFO)({}), { ok: true, value: { version: '0.2.0' } });
});

test('sandbox preload is self-contained CommonJS and never exposes raw ipcRenderer', () => {
  const preload = readFileSync(new URL('../apps/desktop/preload.cjs', import.meta.url), 'utf8');
  assert.match(preload, /contextBridge\.exposeInMainWorld\(['"]harnesscope['"]/);
  assert.match(preload, /ipcRenderer\.invoke/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^,]*ipcRenderer/);
  assert.doesNotMatch(preload, /@electron\/remote/);
  assert.doesNotMatch(preload, /\beval\s*\(/);
});
