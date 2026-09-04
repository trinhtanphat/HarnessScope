# HarnessScope v0.2 Electron Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship HarnessScope v0.2.0 as a secure Electron desktop app with unsigned Windows and macOS packages while preserving the v0.1 CLI, SQLite schema, event model, inference, import, compare, and export behavior.

**Architecture:** Keep all Electron-specific privilege in `apps/desktop`, expose a small versioned preload bridge, and call the existing portable core directly from injected desktop services. The existing renderer remains browser-compatible through a data-client adapter, while CI and release workflows build exact-head Windows and macOS packages only after the portable test matrix is green.

**Tech Stack:** Node.js 22 ESM, built-in `node:sqlite`, Electron 44.1.0, electron-builder 26.15.3, `node:test`, HTML/CSS/JavaScript renderer, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-04-harnesscope-v0.2-electron-desktop-design.md`

## Global Constraints

- Preserve all v0.1 clean-room and secret-redaction boundaries.
- Electron-only imports stay under `apps/desktop`; `src/core`, `src/importers`, and `src/observe` remain directly runnable under Node.js 22.
- Renderer configuration is `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`.
- No `@electron/remote`, renderer `eval`, arbitrary IPC access, auth bypass, TLS-pinning bypass, secret extraction, or vendor security-control bypasses.
- Default desktop DB is `<Electron userData>/HarnessScope/workspace.sqlite`.
- Windows and macOS packages are unsigned in v0.2.0.
- Release tag is exactly `v0.2.0`; no tag/release before exact-head required CI and desktop package gates are green.

---

### Task 1: Versioned desktop contract, validation, and services

**Files:**
- Create: `apps/desktop/channels.mjs`
- Create: `apps/desktop/errors.mjs`
- Create: `apps/desktop/validators.mjs`
- Create: `apps/desktop/paths.mjs`
- Create: `apps/desktop/services.mjs`
- Test: `test/desktop-services.test.mjs`
- Test: `test/desktop-paths.test.mjs`

**Interfaces:**
- Produces: `CHANNELS`, `DesktopError`, `safeResult(fn)`, `assertSessionId(value)`, `validateSessionInput(input)`, `validateLaunchRequest(input)`, `defaultWorkspacePath(userData)`, `createDesktopServices(options)`.
- `createDesktopServices({ dbPath, dialogs, appInfo, platform })` returns async methods for app/workspace info, session list/create, timeline, inference, compare, HAR/Procmon/JSONL import, launch, export, and directory/file pickers.

- [ ] **Step 1: Write failing service/path tests.** Cover exact workspace path, UUID/session validation, bounded launch arguments, safe error envelopes, temp-SQLite session create/list/timeline/inference, and compare serialization.
- [ ] **Step 2: Run `npm test -- test/desktop-services.test.mjs test/desktop-paths.test.mjs` and confirm failure because desktop modules do not exist.**
- [ ] **Step 3: Implement the minimal contract/service modules.** Open/close SQLite per operation; reuse `importHar`, `importProcmon`, `importJsonl`, `inferFindings`, `compareSessions`, `exportSession`, and `launchTarget` directly. Native file/directory selection is injected via `dialogs` for testability.
- [ ] **Step 4: Re-run the focused tests and full `npm test`; both must pass.**
- [ ] **Step 5: Commit `feat: add desktop service contract`.**

### Task 2: Secure preload bridge and Electron main process

**Files:**
- Create: `apps/desktop/bridge.mjs`
- Create: `apps/desktop/ipc.mjs`
- Create: `apps/desktop/navigation.mjs`
- Create: `apps/desktop/preload.mjs`
- Create: `apps/desktop/main.mjs`
- Create: `apps/desktop/README.md`
- Test: `test/desktop-contract.test.mjs`
- Test: `test/desktop-navigation.test.mjs`

**Interfaces:**
- Produces: `createBridge(invoke)`, `registerIpcHandlers({ ipcMain, services })`, `isSafeExternalUrl(url)`, and the packaged Electron entrypoint.
- Bridge shape is exactly `app.info`, `workspace.info`, `session.list/create`, `timeline.get`, `inference.run`, `compare.run`, `import.har/procmon/jsonl`, `launch.run`, `export.run`, `dialog.pickDirectory/pickFile`.

- [ ] **Step 1: Write failing allowlist/navigation tests.** Assert bridge keys exactly match the spec, no raw `ipcRenderer` is exposed, only `https:` external URLs are accepted, and hardening settings appear in the main-process source.
- [ ] **Step 2: Run focused tests and verify RED.**
- [ ] **Step 3: Implement bridge, IPC registration, navigation policy, preload, and BrowserWindow.** `preload.mjs` exposes only `window.harnesscope`; `main.mjs` loads `ui/index.html`, denies unexpected navigation/window creation, opens validated HTTPS links with `shell.openExternal`, and uses `defaultWorkspacePath(app.getPath('userData'))`.
- [ ] **Step 4: Run focused tests and full `npm test`; verify GREEN.**
- [ ] **Step 5: Commit `feat: add secure Electron shell`.**

### Task 3: Desktop-aware renderer and native workflows

**Files:**
- Create: `ui/data-client.js`
- Modify: `ui/index.html`
- Modify: `ui/app.js`
- Modify: `ui/styles.css`
- Test: `test/ui-data-client.test.mjs`
- Modify: `test/ui.test.mjs`

**Interfaces:**
- Produces: `createDataClient({ bridge, fetchImpl })` with `mode`, `appInfo`, `listSessions`, `createSession`, `getTimeline`, `runInference`, `runCompare`, `importEvidence`, `launch`, `exportSession`.
- Browser mode keeps current GET session/timeline and inference behavior through the local HTTP server; desktop-only actions are visibly disabled when no bridge exists.

- [ ] **Step 1: Write failing adapter/UI static tests.** Test desktop envelope unwrapping, browser fallback, CSP, relative asset URLs, and existence of New Session / Import / Launch / Compare / Export controls.
- [ ] **Step 2: Run focused tests and verify RED.**
- [ ] **Step 3: Implement `data-client.js` and extend the renderer.** Add CSP; use `./styles.css`, `./data-client.js`, `./app.js`; add native-action toolbar, import type selector, `<dialog>` forms for new session/launch/compare, platform badge, disabled state for long operations, and safe toast errors without stack traces.
- [ ] **Step 4: Preserve existing trace grouping, event/finding inspector, filters, Trace/Spec tabs, and browser UI test.**
- [ ] **Step 5: Run focused tests and full `npm test`; verify GREEN.**
- [ ] **Step 6: Commit `feat: add native desktop renderer workflows`.**

### Task 4: Electron packaging and version consistency

**Files:**
- Modify: `package.json`
- Create: `test/desktop-package.test.mjs`
- Modify: `.gitignore` only if new builder output needs exclusion.

**Interfaces:**
- Package version: `0.2.0`.
- Main entry: `apps/desktop/main.mjs`.
- Dev dependencies pinned: `electron: 44.1.0`, `electron-builder: 26.15.3`.
- Scripts: `desktop`, `desktop:pack`, `desktop:win`, `desktop:mac`.
- Builder app id: `com.trinhtanphat.harnessscope`; product name: `HarnessScope`; output: `dist/desktop`.

- [ ] **Step 1: Write failing package-contract test.** Verify version, main entry, pinned dependencies, `asar: true`, packaged file allowlist, Windows NSIS+ZIP x64 targets, macOS DMG+ZIP universal targets, and no signing identity requirement.
- [ ] **Step 2: Run focused test and verify RED.**
- [ ] **Step 3: Update `package.json` with the exact packaging config and scripts.** Do not add Electron imports to portable core modules.
- [ ] **Step 4: Run `npm test` and verify GREEN under plain Node without installing Electron.**
- [ ] **Step 5: Commit `build: configure Electron desktop packaging`.**

### Task 5: Cross-platform CI desktop build gates

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `test/ci-contract.test.mjs`

**Interfaces:**
- Existing `test` matrix remains Ubuntu/Windows/macOS Node 22.
- New required jobs: `desktop-windows`, `desktop-macos`.

- [ ] **Step 1: Write failing static CI contract test.** Require Windows and macOS jobs, dependency installation, tests before package, `electron-builder`, unsigned macOS environment, expected artifact validation, and workflow artifact upload.
- [ ] **Step 2: Run focused test and verify RED.**
- [ ] **Step 3: Extend CI.** Windows installs dependencies, runs `npm test`, builds NSIS+ZIP x64 and validates non-empty `.exe`/`.zip`; macOS installs dependencies, runs tests, builds unsigned universal DMG+ZIP and validates non-empty artifacts. Upload build outputs with `actions/upload-artifact`.
- [ ] **Step 4: Run `npm test` locally/through current Node runner; then wait for exact branch GitHub Actions to complete.** If a platform build fails, read the exact failing job log, fix root cause, and rerun until all required jobs are green.
- [ ] **Step 5: Commit `ci: build HarnessScope desktop on Windows and macOS`.**

### Task 6: Fail-closed v0.2.0 release workflow and documentation

**Files:**
- Create: `.github/workflows/release-v0.2.0.yml`
- Delete: `.github/workflows/release-v0.1.0.yml`
- Modify: `README.md`
- Create: `test/release-contract.test.mjs`

**Interfaces:**
- Required release assets: `HarnessScope-0.2.0-Setup.exe`, `HarnessScope-0.2.0-windows-portable.zip`, `HarnessScope-0.2.0-macos-universal.dmg`, `HarnessScope-0.2.0-macos-universal.app.zip`, `HarnessScope-0.2.0-source.zip`, `SHA256SUMS.txt`.

- [ ] **Step 1: Write failing release contract test.** Require `workflow_run` success on `ci` + `main`, exact triggering SHA checkout, package version guard, independent Windows/macOS package jobs, release job depending on both, checksums, idempotent tag guard, and exact asset names.
- [ ] **Step 2: Run focused test and verify RED.**
- [ ] **Step 3: Implement release workflow.** Rebuild exact triggering SHA on native Windows/macOS runners, normalize builder output names, upload workflow artifacts, then on Ubuntu download both, create source ZIP and SHA256 file, and create `v0.2.0` only when all gates succeeded. Existing tag causes a verification/skip path rather than a conflicting tag.
- [ ] **Step 4: Retire the completed v0.1 release workflow and update README with desktop launch/build instructions plus unsigned Windows SmartScreen and macOS Control-click → Open guidance.** Do not instruct users to disable Gatekeeper or quarantine globally.
- [ ] **Step 5: Run full `npm test`; verify all static contracts and v0.1 regressions remain green.**
- [ ] **Step 6: Commit `release: prepare HarnessScope v0.2.0 desktop release`.**

### Task 7: PR, exact-head verification, merge, tag, and release verification

**Files:**
- No new source files unless CI exposes a concrete defect.

**Interfaces:**
- Branch: `feature/v0.2-electron-desktop`.
- Base: `main`.
- Release: `v0.2.0`.

- [ ] **Step 1: Open a PR to `main` summarizing desktop architecture, security boundary, package targets, and unsigned status.**
- [ ] **Step 2: Verify exact PR head CI: portable tests green on Ubuntu/Windows/macOS and desktop package jobs green on Windows/macOS.** Fix only evidence-backed failures; never bypass failed gates.
- [ ] **Step 3: Merge the PR without force/bypass once exact-head CI is green.**
- [ ] **Step 4: Verify `main` exact-head CI is green.** The successful main CI triggers `release-v0.2.0`.
- [ ] **Step 5: Wait for release workflow completion.** Verify tag `v0.2.0` points at the exact merged main SHA and GitHub Release is published, non-draft, non-prerelease.
- [ ] **Step 6: Verify all six required assets exist and are non-empty; report SHA, workflow run, release URL, and any unsigned-launch caveats.**
