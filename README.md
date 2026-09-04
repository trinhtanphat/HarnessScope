# HarnessScope

HarnessScope is a standalone clean-room inspector for coding-agent harness behavior. It helps you collect **authorized evidence** from CLI or desktop agent sessions, normalize it into one timeline, infer visible orchestration patterns, compare sessions, and export an implementation-neutral behavioral specification.

HarnessScope does **not** extract a vendor's hidden source code. It records evidence you are authorized to observe and labels derived conclusions as evidence-backed inference.

## What it includes

- Node.js 22 portable CLI and browser UI;
- SQLite workspace database with WAL mode;
- redaction before persistence;
- HAR 1.2, Procmon CSV and generic JSONL importers;
- owned-process launch observation and metadata-only file watching;
- deterministic harness inference and CLI-vs-Desktop comparison;
- Markdown/JSON/tool-schema clean-room export;
- Electron v0.2 desktop app for Windows and macOS with a sandboxed renderer, context isolation and strict IPC allowlist;
- synthetic fixtures and automated tests.

## Clean-room / authorization boundary

Use HarnessScope only on applications, logs, files and environments you own or are authorized to inspect.

HarnessScope intentionally does **not** bypass authentication or access controls, defeat TLS certificate pinning, silently install interception certificates, extract passwords/API keys/cookies/bearer tokens, scrape process memory for secrets, decompile protected proprietary source, or disable vendor security controls.

HAR/Procmon/JSONL are user-supplied evidence. External observability tools may be used under your own authorization and their exported artifacts imported into HarnessScope.

## Requirements

For the portable CLI/core:

- Node.js **22+**;
- Windows, macOS or Linux;
- Procmon is optional and Windows-only.

The portable CLI uses Node built-ins and does not require `npm install` for normal use. Building or running the Electron desktop app from source does require `npm install`.

## Desktop v0.2.0

HarnessScope v0.2.0 adds native Electron packages while preserving the v0.1 CLI, workspace schema, inference and export behavior.

Release assets:

```text
Windows
├─ HarnessScope-0.2.0-Setup.exe
└─ HarnessScope-0.2.0-windows-portable.zip

macOS
├─ HarnessScope-0.2.0-macos-universal.dmg
└─ HarnessScope-0.2.0-macos-universal.app.zip

Source / verification
├─ HarnessScope-0.2.0-source.zip
└─ SHA256SUMS.txt
```

### Unsigned package note

The Windows and macOS packages in v0.2.0 are intentionally **unsigned**.

On Windows, Microsoft Defender SmartScreen may warn that the publisher is unknown. Verify the release checksum first, then use the normal SmartScreen **More info → Run anyway** flow only if you trust the downloaded release.

On macOS, Gatekeeper may block the unsigned app on first launch. Verify the release checksum first, then in Finder **Control-click** the HarnessScope app and choose **Open**, followed by **Open** again when macOS asks for confirmation. HarnessScope does not require disabling Gatekeeper or changing system-wide security settings.

### Run desktop from source

```bash
npm install
npm run desktop
```

Build packages locally:

```bash
npm run desktop:win   # Windows
npm run desktop:mac   # macOS universal
```

Electron security defaults in v0.2.0 include `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, and `allowRunningInsecureContent: false`. The renderer receives only the versioned `window.harnesscope` bridge; raw `ipcRenderer` is not exposed.

## Portable CLI quick start

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

Open `http://127.0.0.1:4173`. The browser UI keeps the read/infer workflow, while desktop-only actions are disabled when the Electron bridge is absent.

The UI provides session navigation, Trace/Spec tabs, grouped event traces, filtering, event/finding inspectors, confidence/provenance display, and inference for the selected session.

## Inference boundary

HarnessScope can infer evidence-backed patterns such as progressive skill/instruction loading, permission gates, observed tool schemas, inspect/mutate/execute/verify loops, explicit context/compaction/resume markers, and session state persisted across restart.

It does not invent hidden prompts, token counts or internal implementation details when evidence is absent.

## Tests

```bash
npm test
```

CI runs the portable test suite on Ubuntu, Windows and macOS. Desktop build gates additionally install the pinned Electron toolchain, rerun tests, build Windows/macOS packages, validate non-empty expected outputs, and upload build artifacts.

## Repository layout

```text
apps/desktop/          Electron main/preload/IPC/service layer
bin/                   CLI entrypoint
src/core/              redaction, store, inference, compare, exporter
src/importers/         HAR, Procmon CSV, JSONL
src/observe/           owned-process launch + metadata file watcher
src/ui/                local HTTP/API server
ui/                    shared browser/Electron renderer
fixtures/              synthetic evidence and dummy agent
test/                  Node test suite
docs/                  design, plans and observation tutorial
```

## License

Apache-2.0 for HarnessScope-owned code. No Anthropic, Claude Code, or other vendor source/assets are included.
