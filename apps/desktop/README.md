# HarnessScope Desktop

Electron desktop shell for HarnessScope v0.2.

The privileged main process reuses the portable HarnessScope core directly. The renderer is sandboxed and receives only the versioned `window.harnesscope` API exposed by `preload.cjs`.

## Security boundary

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- HTTPS-only external navigation, opened in the system browser
- exact IPC allowlist; raw `ipcRenderer` is never exposed
- no `@electron/remote`, renderer eval, secret extraction, or security-control bypasses

`preload.cjs` is intentionally CommonJS and self-contained. Electron sandboxed preload scripts cannot use ESM imports; the Electron main process remains ESM.
