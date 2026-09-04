# HarnessScope

HarnessScope is a standalone clean-room inspector for coding-agent harness behavior. It helps you collect **authorized evidence** from CLI or desktop agent sessions, normalize it into one timeline, infer visible orchestration patterns, compare sessions, and export an implementation-neutral behavioral specification.

HarnessScope does **not** extract a vendor's hidden source code. It records evidence you are authorized to observe and labels derived conclusions as evidence-backed inference.

## What it includes

- preferred Rust/Tauri v0.3 desktop runtime for Windows and macOS;
- Node.js 22 portable CLI and browser UI;
- Electron desktop fallback retained for migration and regression coverage;
- Rust `harnesscope-core` with Node/Rust semantic parity fixtures;
- SQLite workspace database with WAL mode and a shared cross-runtime writer lock;
- redaction before persistence;
- HAR 1.2, Procmon CSV and generic JSONL importers;
- owned-process launch observation and metadata-only file watching;
- deterministic harness inference and CLI-vs-Desktop comparison;
- Markdown/JSON/tool-schema clean-room export;
- synthetic fixtures and automated cross-platform tests.

## Clean-room / authorization boundary

Use HarnessScope only on applications, logs, files and environments you own or are authorized to inspect.

HarnessScope intentionally does **not** bypass authentication or access controls, defeat TLS certificate pinning, silently install interception certificates, extract passwords/API keys/cookies/bearer tokens, scrape process memory for secrets, decompile protected proprietary source, or disable vendor security controls.

HAR/Procmon/JSONL are user-supplied evidence. External observability tools may be used under your own authorization and their exported artifacts imported into HarnessScope.

## Requirements

For the portable Node CLI/core:

- Node.js **22+**;
- Windows, macOS or Linux;
- Procmon is optional and Windows-only.

For the preferred Tauri desktop runtime:

- Rust **1.98.1** from the pinned `rust-toolchain.toml`;
- Node.js 22 for the pinned Tauri CLI;
- Windows x64 or macOS universal build hosts for native packages.

The portable Node CLI uses Node built-ins and does not require `npm install` for normal use. Building either desktop runtime from source requires the locked npm dependencies.

## Desktop v0.3.0 — preferred Tauri runtime

HarnessScope v0.3.0 makes the Rust/Tauri desktop shell the preferred Windows/macOS runtime while preserving the v0.2 SQLite/workspace contract, shared renderer action contract, Node CLI, browser UI, and Electron fallback.

The release is fail-closed: `v0.3.0` is published only from the exact successful `main` CI SHA after Node, Rust core, Node/Rust parity, Windows Tauri, and macOS Tauri gates are green.

Release assets:

```text
Windows
├─ HarnessScope-0.3.0-windows-x64-Setup.exe
├─ HarnessScope-0.3.0-windows-x64.msi
└─ HarnessScope-0.3.0-windows-x64-portable.zip

macOS
├─ HarnessScope-0.3.0-macos-universal.dmg
└─ HarnessScope-0.3.0-macos-universal.app.zip

Source / verification
├─ HarnessScope-0.3.0-source.zip
└─ SHA256SUMS.txt
```

### Unsigned package note

The Windows and macOS packages in v0.3.0 are intentionally **unsigned**.

On Windows, Microsoft Defender SmartScreen may warn that the publisher is unknown. Verify `SHA256SUMS.txt` first, then use the normal SmartScreen **More info → Run anyway** flow only if you trust the exact downloaded release. HarnessScope does not require disabling SmartScreen, Defender, or other platform security controls.

On macOS, Gatekeeper may block the unsigned app on first launch. Verify `SHA256SUMS.txt` first, then in Finder **Control-click** the HarnessScope app and choose **Open**, followed by **Open** again when macOS asks for confirmation. HarnessScope does not require disabling Gatekeeper or changing system-wide security settings.

### Run the preferred Tauri desktop from source

```bash
npm ci
npm run tauri:dev
```

Native package builds:

```bash
npm run tauri:win   # Windows x64
npm run tauri:mac   # macOS universal
```

The Tauri shell exposes only the explicit HarnessScope command allowlist. Renderer code does not receive unrestricted filesystem, shell, process, SQLite, Electron, or Tauri APIs.

### Electron fallback

The Electron runtime remains supported as a fallback during the v0.3 migration and for regression coverage:

```bash
npm ci
npm run desktop
```

Fallback package builds:

```bash
npm run desktop:win
npm run desktop:mac
```

Electron keeps `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, and `allowRunningInsecureContent: false`. The renderer receives only the versioned `window.harnesscope` bridge; raw `ipcRenderer` is not exposed.

## Portable Node CLI quick start

```bash
node bin/harnesscope.mjs --help
```

Create a workspace session:

```bash
node bin/harnesscope.mjs \
  --db ./lab/workspace.sqlite \
  session new --name agent-cli-baseline --mode cli
```

Launch an owned CLI target:

```bash
node bin/harnesscope.mjs \
  --db ./lab/workspace.sqlite \
  launch --session <SESSION> -- <target-command>
```

Import evidence:

```bash
node bin/harnesscope.mjs --db ./lab/workspace.sqlite import har --session <SESSION> ./capture/session.har
node bin/harnesscope.mjs --db ./lab/workspace.sqlite import procmon --session <SESSION> ./capture/procmon.csv --date 2026-09-04
node bin/harnesscope.mjs --db ./lab/workspace.sqlite import jsonl --session <SESSION> ./capture/events.jsonl --map ./capture/map.yaml
```

Sensitive headers, cookies, common secret fields and common token patterns are replaced with `[REDACTED]` before events are committed to SQLite.

Infer and export:

```bash
node bin/harnesscope.mjs --db ./lab/workspace.sqlite infer --session <SESSION>
node bin/harnesscope.mjs --db ./lab/workspace.sqlite export --session <SESSION> --out ./lab/export
```

Compare sessions:

```bash
node bin/harnesscope.mjs --db ./lab/workspace.sqlite compare <SESSION_A> <SESSION_B>
```

## Browser UI

```bash
node bin/harnesscope.mjs --db ./lab/workspace.sqlite ui --port 4173
```

Open `http://127.0.0.1:4173`. The browser UI keeps the read/infer workflow, while native-only actions are disabled when no desktop bridge is present.

The UI provides session navigation, Trace/Spec tabs, grouped event traces, filtering, event/finding inspectors, confidence/provenance display, and inference for the selected session.

## Inference boundary

HarnessScope can infer evidence-backed patterns such as progressive skill/instruction loading, permission gates, observed tool schemas, inspect/mutate/execute/verify loops, explicit context/compaction/resume markers, and session state persisted across restart.

It does not invent hidden prompts, token counts or internal implementation details when evidence is absent.

## Tests and parity

```bash
npm ci
npm test
cargo fmt --all -- --check
cargo clippy -p harnesscope-core -p harnesscope-parity --all-targets -- -D warnings
cargo test -p harnesscope-core -p harnesscope-parity
node scripts/run-parity.mjs
```

CI runs Node tests on Ubuntu, Windows and macOS, Rust core/parity checks on all three platforms, explicit semantic parity, and native Tauri package gates on Windows and macOS. Native jobs validate non-empty normalized v0.3 artifacts before upload.

## Repository layout

```text
apps/desktop/          Electron fallback main/preload/IPC/service layer
apps/tauri/            preferred Tauri shell and native configuration
bin/                   Node CLI entrypoint
crates/harnesscope-core/   framework-independent Rust core
crates/harnesscope-parity/ Node/Rust parity transport
src/core/              Node redaction, store, inference, compare, exporter
src/importers/         Node HAR, Procmon CSV, JSONL importers
src/observe/           owned-process launch + metadata file watcher
src/ui/                local HTTP/API server
ui/                    shared browser/Electron/Tauri renderer
fixtures/              synthetic evidence, parity and compatibility fixtures
scripts/               parity and native packaging helpers
test/                  Node contract/regression suite
docs/                  design, plans and observation tutorial
```

## License

Apache-2.0 for HarnessScope-owned code. No Anthropic, Claude Code, or other vendor source/assets are included.
