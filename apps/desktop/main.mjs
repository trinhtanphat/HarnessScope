import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireWorkspaceLock } from '../../src/core/workspace-lock.mjs';
import { defaultWorkspacePath } from './paths.mjs';
import { createDesktopServices } from './services.mjs';
import { registerIpcHandlers } from './ipc.mjs';
import { isSafeExternalUrl } from './navigation.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const rendererFile = join(root, 'ui', 'index.html');
const preloadFile = join(here, 'preload.cjs');

function nativeDialogs() {
  return {
    async pickFile(options = {}) {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: Array.isArray(options.filters) ? options.filters : []
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    async pickDirectory() {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    }
  };
}

function installNavigationPolicy(win) {
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b0d12',
    title: 'HarnessScope',
    webPreferences: {
      preload: preloadFile,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  installNavigationPolicy(win);
  win.once('ready-to-show', () => win.show());
  void win.loadFile(rendererFile);
  return win;
}

await app.whenReady();

const dbPath = defaultWorkspacePath(app.getPath('userData'));
const workspaceLease = acquireWorkspaceLock(dbPath, { runtime: 'electron-desktop' });
let services = null;
app.on('before-quit', () => {
  if (services?.collectorShutdown) void services.collectorShutdown();
  workspaceLease.release();
});

try {
  services = createDesktopServices({
    dbPath,
    dialogs: nativeDialogs(),
    appInfo: { name: app.getName(), version: app.getVersion() },
    platform: process.platform
  });
  registerIpcHandlers({ ipcMain, services });
  createWindow();
} catch (error) {
  workspaceLease.release();
  throw error;
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
