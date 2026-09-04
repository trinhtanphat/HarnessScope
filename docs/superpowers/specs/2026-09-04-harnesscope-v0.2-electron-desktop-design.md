# HarnessScope v0.2 — Electron Desktop Design

## Status
Approved direction: unsigned native desktop release for Windows and macOS using Electron, while preserving the v0.1 core/event/database contracts so a future v0.3 Tauri/Rust migration remains straightforward.

## Goals
HarnessScope v0.2 turns the existing local browser UI into a real desktop application without rewriting the proven Node.js core. The release must provide installable or launchable desktop artifacts for Windows and macOS, keep the existing CLI fully functional, and make release publication fail-closed on cross-platform verification.

Primary outcomes:

- Windows desktop artifact: NSIS installer `.exe` plus portable `.zip`.
- macOS desktop artifacts: unsigned `.dmg` plus `.app.zip`.
- Existing Node.js CLI remains supported.
- The Electron renderer never receives unrestricted Node.js access.
- Existing SQLite workspace, trace event, inference, import, compare, and export contracts remain stable.
- CI verifies Linux core tests and Windows/macOS desktop builds before a v0.2.0 release is created.

## Non-goals
v0.2 does not:

- port the core to Rust;
- ship a Tauri shell;
- code-sign Windows binaries;
- sign or notarize macOS artifacts;
- add TLS pinning bypass, credential extraction, memory scraping, or vendor security-control bypasses;
- change the clean-room evidence model established in v0.1;
- require a paid certificate or Apple Developer account.

## Architecture

```text
HarnessScope Desktop

Electron main process
    │
    ├── Workspace path / lifecycle
    ├── SQLite core
    ├── Imports
    ├── Process launcher / file watcher
    ├── Inference / compare / export
    └── Native dialogs
            │
        strict IPC allowlist
            │
        preload bridge
            │
        Electron renderer
            │
        existing HarnessScope UI
```

The desktop app reuses the existing JavaScript modules directly instead of spawning the CLI for internal operations. This avoids parsing command output and preserves a single implementation of storage, import, inference, and export behavior.

## Repository layout

```text
apps/
└─ desktop/
   ├─ main.mjs
   ├─ preload.mjs
   ├─ ipc.mjs
   ├─ paths.mjs
   └─ README.md

ui/                      existing renderer assets, extended for desktop bridge
src/                     existing portable core and collectors
build/                    icons and packaging resources owned by HarnessScope
.github/workflows/
├─ ci.yml                 core + desktop verification matrix
└─ release-v0.2.0.yml     fail-closed release publication
```

No duplicate copy of the core will live under `apps/desktop`.

## Desktop process model

### Main process
The Electron main process owns privileged capabilities:

- opening and closing the SQLite workspace;
- creating/listing sessions;
- importing selected HAR/Procmon/JSONL evidence;
- launching explicitly user-selected commands;
- metadata file watching within explicitly selected directories;
- running inference, compare, and export;
- opening native file/directory dialogs;
- exposing application/version/platform metadata.

The main process must not expose arbitrary filesystem reads, arbitrary shell execution APIs, `eval`, remote modules, or unrestricted Electron objects to the renderer.

### Preload bridge
`contextBridge` exposes one small `window.harnesscope` API with versioned methods. The renderer cannot call `ipcRenderer` directly.

Initial bridge surface:

```text
app.info()
workspace.info()
session.list()
session.create(input)
timeline.get(sessionId)
inference.run(sessionId)
compare.run(sessionA, sessionB)
import.har(sessionId)
import.procmon(sessionId)
import.jsonl(sessionId)
launch.run(sessionId, launchRequest)
export.run(sessionId)
dialog.pickDirectory()
dialog.pickFile(filters)
```

Every IPC handler validates primitive types, IDs, path expectations, and bounded input sizes before invoking the core.

## Electron hardening

BrowserWindow defaults for v0.2:

```text
nodeIntegration: false
contextIsolation: true
sandbox: true
webSecurity: true
allowRunningInsecureContent: false
```

Additional rules:

- no `@electron/remote`;
- no renderer `eval` or dynamic code execution;
- deny unexpected navigation;
- open external URLs only after validating `https:` and using the OS browser;
- load local packaged UI via a local file/application URL only;
- CSP disallows remote scripts and inline executable script where practical;
- no secrets are sent to the renderer before the existing redaction boundary;
- IPC errors return normalized messages rather than raw privileged objects.

## Workspace and persistence

Default desktop workspace database:

```text
<Electron userData>/HarnessScope/workspace.sqlite
```

The user may open another HarnessScope workspace explicitly in a later minor release, but v0.2 only needs the managed default workspace to minimize destructive path handling.

SQLite schema and event representation stay compatible with v0.1. CLI and Desktop may open the same workspace when not concurrently writing. v0.2 documents that users should not run CLI and Desktop against the same database simultaneously.

## Renderer / UX

The existing dark Trace/Spec UI becomes the desktop renderer and gains a desktop-aware command bar.

Main layout remains:

- left: sessions;
- center: grouped trace timeline;
- right: selected event/finding inspector;
- top: `Trace` / `Spec` tabs;
- bottom or toolbar actions: New Session, Import, Launch, Infer, Compare, Export.

Desktop-specific UX:

- native file picker for imports;
- native directory picker for exports/watch paths;
- modal launch form showing command + args before execution;
- explicit platform/status badge;
- visible unsigned-build notice only in About/Release notes, not as a persistent warning banner;
- actionable error toasts with no stack traces by default.

The renderer should continue to work in browser-development mode with a small adapter so UI code is not tightly coupled to Electron.

## Packaging

Use Electron Builder for v0.2 packaging.

### Windows
Required release outputs:

```text
HarnessScope-0.2.0-Setup.exe
HarnessScope-0.2.0-windows-portable.zip
```

Installer is unsigned. README/release notes warn that Windows SmartScreen may display an unknown publisher warning.

### macOS
Required release outputs:

```text
HarnessScope-0.2.0-macos-universal.dmg
HarnessScope-0.2.0-macos-universal.app.zip
```

The build is unsigned and not notarized. Release notes explain the normal macOS control-click / Open workflow for an unidentified developer build. The release workflow must not attempt to alter Gatekeeper or quarantine settings automatically.

Universal packaging should contain both `x64` and `arm64` support when Electron Builder can produce a universal bundle in GitHub-hosted macOS CI. If universal packaging is unreliable, the permitted fallback is two explicit artifacts (`macos-x64` and `macos-arm64`) rather than silently shipping one architecture under a universal name.

### Linux
Linux remains a core-test platform. A Linux desktop artifact is optional for v0.2 and must not block the Windows/macOS release unless explicitly promoted to required before release.

## Dependency strategy

v0.1 intentionally had no third-party runtime dependencies. v0.2 introduces development/build dependencies for Electron packaging. Dependency changes are limited to what is needed for the desktop shell and packaging.

Expected categories:

- `electron`;
- `electron-builder`;
- minimal packaging helper if universal macOS merge requires it.

The core modules remain free of Electron imports so they stay portable and directly testable under Node.js.

## Versioning

`package.json` becomes version `0.2.0` when the release candidate is prepared.

Desktop app version, package version, release tag, and artifact names derive from one version source. CI must fail if the release workflow expects `0.2.0` but package metadata differs.

Tag:

```text
v0.2.0
```

## CI design

### Core test matrix
Required on every push/PR:

- Ubuntu latest — Node 22, `npm test`;
- Windows latest — Node 22, `npm test`;
- macOS latest — Node 22, `npm test`.

### Desktop verification
Required for changes that affect desktop/build configuration:

- Windows: install dependencies, desktop smoke test, package unpacked/installer target;
- macOS: install dependencies, desktop smoke test, package app/DMG target;
- validate expected artifacts are non-empty;
- run a packaged-app smoke where practical without requiring interactive GUI automation.

The desktop smoke test must at minimum verify:

1. preload exports only the documented API;
2. main IPC handlers can create/list a session using an isolated temporary workspace;
3. inference/timeline calls return serializable values;
4. packaged main entry loads without syntax/module-resolution errors.

## Release workflow

`release-v0.2.0.yml` is fail-closed.

Release sequence:

```text
main exact head
    ↓
core CI green on Ubuntu + Windows + macOS
    ↓
desktop Windows build green
    ↓
desktop macOS build green
    ↓
collect exact-head artifacts
    ↓
verify version + checksums
    ↓
create tag v0.2.0
    ↓
create GitHub Release + upload assets
```

No tag or GitHub Release is created before all required gates are green. Rerunning a failed workflow must remain idempotent: if `v0.2.0` already exists, the workflow verifies the existing release rather than creating conflicting tags.

Release includes:

- Windows setup executable;
- Windows portable archive;
- macOS DMG;
- macOS app ZIP;
- source archive;
- `SHA256SUMS.txt`;
- concise unsigned-install instructions.

## Testing strategy

Existing v0.1 tests stay intact. New tests cover boundaries rather than Electron internals where possible.

Required additions:

- IPC input validation tests;
- preload allowlist test;
- desktop workspace-path test;
- IPC session/timeline/inference integration test with temporary SQLite DB;
- navigation/external-link policy test;
- version consistency check;
- package configuration validation test;
- release workflow/static contract checks where useful.

Tests must not require access to Claude, proprietary apps, paid signing identities, or network interception.

## Error handling

Desktop operations return a stable result envelope:

```json
{
  "ok": false,
  "code": "IMPORT_INVALID_FILE",
  "message": "The selected HAR file could not be imported."
}
```

Raw stack traces stay in main-process logs in development. Renderer messages are concise and safe.

Long-running actions disable duplicate UI submission and expose completion/error state. v0.2 does not need a generalized background job engine.

## Migration path to v0.3

v0.2 deliberately establishes boundaries that allow Electron to be replaced later:

```text
Renderer UI
    ↓
versioned desktop bridge contract
    ↓
application services
    ↓
portable HarnessScope core
```

For v0.3, a Tauri/Rust implementation can replace the Electron main/preload layer while preserving:

- event schema;
- SQLite schema or migration contract;
- renderer action semantics;
- clean-room inference/export behavior;
- release artifact semantics.

Electron-only APIs must remain confined to `apps/desktop`.

## Success criteria
v0.2 is complete only when:

1. Existing CLI tests remain green on Ubuntu, Windows, and macOS.
2. HarnessScope launches as an Electron app from source.
3. Desktop can create/select sessions, view traces/findings, import evidence, run inference, and export a spec through the secure bridge.
4. Renderer has no direct Node.js/Electron privilege surface.
5. Windows packaging produces an unsigned installer and portable archive.
6. macOS packaging produces unsigned launchable app artifacts for Intel and Apple Silicon, preferably one universal app.
7. Exact-head CI is green across required platforms.
8. Only then is `v0.2.0` tagged and published with SHA256 checksums.

## Future v0.3 candidates
Not part of v0.2 implementation, but the design leaves room for:

- Tauri desktop shell;
- Rust core migration;
- signed/notarized builds when credentials become available;
- richer process-tree observation;
- workspace switching and locking;
- plugin/import adapter SDK;
- session replay and richer diff visualization.
