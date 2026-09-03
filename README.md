# HarnessScope

HarnessScope is a standalone clean-room inspector for coding-agent harness behavior. It helps you collect **authorized evidence** from a CLI or desktop agent session, normalize it into one timeline, infer visible orchestration patterns, compare sessions, and export an implementation-neutral behavioral specification.

It is designed for questions such as:

- Which files or instruction/skill documents were read before execution?
- Which tool calls and results occurred, and in what order?
- Was a permission decision observed before a sensitive action?
- Did the client emit visible context compaction/resume markers?
- Which state files were written before exit and read after restart?
- What differs between a CLI session and a desktop session?

HarnessScope does **not** extract a vendor's hidden source code. It records evidence you are authorized to observe and labels all derived conclusions as evidence-backed inference.

## What V1 includes

- dependency-free Node.js 22 CLI;
- SQLite workspace database with WAL mode;
- redaction before persistence;
- HAR 1.2 importer;
- Procmon CSV importer;
- generic JSONL importer with a small YAML field map;
- owned-process launch observation;
- metadata-only directory watcher;
- deterministic harness inference;
- CLI-vs-Desktop session comparison;
- clean-room Markdown/JSON/tool-schema export;
- dark desktop-style local UI with `Trace` / `Spec`, grouped execution traces, filters, event inspector, finding confidence and evidence provenance;
- synthetic dummy-agent fixtures and automated tests.

## Clean-room / authorization boundary

Use HarnessScope only on applications, logs, files and environments you own or are authorized to inspect.

V1 intentionally does **not**:

- bypass authentication or access controls;
- defeat TLS certificate pinning;
- silently install interception certificates;
- extract passwords, API keys, cookies or bearer tokens;
- scrape process memory for secrets;
- decompile or dump proprietary source from protected binaries;
- disable vendor security controls.

HAR/Procmon/JSONL are user-supplied evidence. You may use external observability tools under your own authorization, then import their exported artifacts into HarnessScope.

## Requirements

- Node.js **22+**
- Windows, macOS or Linux for the portable core/CLI
- Procmon is optional and Windows-only; HarnessScope consumes its exported CSV rather than requiring kernel privileges itself.

No `npm install` is required for V1.

## Quick start

```bash
node bin/harnesscope.mjs --help
```

Create a workspace session:

```bash
node bin/harnesscope.mjs \
  --db ./lab/workspace.sqlite \
  session new --name claude-cli-baseline --mode cli
```

The command returns a session id. Use it below as `<SESSION>`.

### Launch a CLI target

```bash
node bin/harnesscope.mjs \
  --db ./lab/workspace.sqlite \
  launch --session <SESSION> -- claude
```

`launch` stores the owned process start/exit. HarnessScope does **not** persist arbitrary stdout/stderr. Repository-owned fixtures can emit explicit `HARNESSCOPE_EVENT ...` lines for deterministic integration testing.

### Import Procmon CSV

```bash
node bin/harnesscope.mjs \
  --db ./lab/workspace.sqlite \
  import procmon --session <SESSION> ./capture/procmon.csv --date 2026-09-04
```

### Import HAR

```bash
node bin/harnesscope.mjs \
  --db ./lab/workspace.sqlite \
  import har --session <SESSION> ./capture/session.har
```

Sensitive headers, cookies, common secret fields and common token patterns are replaced with `[REDACTED]` before the event is committed to SQLite.

### Import generic JSONL

Mapping file:

```yaml
timestamp: ts
kind: event
correlationId: cid
data: payload
source: external-jsonl
```

Import:

```bash
node bin/harnesscope.mjs \
  --db ./lab/workspace.sqlite \
  import jsonl --session <SESSION> ./capture/events.jsonl --map ./capture/map.yaml
```

### Infer harness behavior

```bash
node bin/harnesscope.mjs \
  --db ./lab/workspace.sqlite \
  infer --session <SESSION>
```

V1 inference looks for evidence of:

- progressive skill/instruction loading;
- permission gates;
- observed tool schemas;
- inspect/mutate/execute/verify loops;
- explicit context/compaction/resume markers;
- session state persisted across process restart.

It does not invent hidden token counts or internal prompts when evidence is absent.

### Export clean-room spec

```bash
node bin/harnesscope.mjs \
  --db ./lab/workspace.sqlite \
  export --session <SESSION> --out ./lab/export
```

Output:

```text
lab/export/
├─ harness-spec.md
├─ harness-spec.json
└─ tool-schemas/
```

### Compare CLI and Desktop sessions

```bash
node bin/harnesscope.mjs \
  --db ./lab/workspace.sqlite \
  compare <CLI_SESSION> <DESKTOP_SESSION>
```

The diff reports shared and session-specific event kinds, observed tools and finding categories.

## Desktop-style UI

Start the local UI:

```bash
node bin/harnesscope.mjs --db ./lab/workspace.sqlite ui --port 4173
```

Open:

```text
http://127.0.0.1:4173
```

The UI provides:

- session sidebar;
- `Trace` and `Spec` tabs;
- compact grouped trace cards;
- event-kind filtering;
- event detail inspector;
- evidence-backed findings with confidence;
- one-click inference for the selected session.

## Synthetic smoke demo

```bash
DB=./demo/workspace.sqlite
SESSION=$(node bin/harnesscope.mjs --db "$DB" session new --name demo --mode desktop --json | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).id")
node bin/harnesscope.mjs --db "$DB" launch --session "$SESSION" -- node fixtures/dummy-agent.mjs
node bin/harnesscope.mjs --db "$DB" infer --session "$SESSION"
node bin/harnesscope.mjs --db "$DB" export --session "$SESSION" --out ./demo/spec
```

On Windows PowerShell, run the commands separately and copy the returned session id.

## Tests

```bash
npm test
```

The test suite covers secret redaction, SQLite persistence, HAR/Procmon/JSONL imports, inference rules, session comparison, deterministic export, CLI end-to-end flow and UI APIs.

## Repository layout

```text
bin/                  CLI entrypoint
src/core/             redaction, store, inference, compare, exporter
src/importers/        HAR, Procmon CSV, JSONL
src/observe/          owned process launch + metadata file watcher
src/ui/               local HTTP/API server
ui/                   desktop-style browser UI
fixtures/             synthetic evidence and dummy agent
test/                 Node test suite
docs/                 design, plan and observation tutorial
```

## Architecture note

The approved product design describes a future Rust core + Tauri desktop build. The executable V1 in this repository uses Node.js 22 built-ins so the complete behavior can run without third-party package installation. The storage/event/CLI contracts are deliberately implementation-neutral so a later Rust/Tauri port can preserve the same workspace and clean-room semantics.

## License

Apache-2.0 for HarnessScope-owned code. No Anthropic, Claude Code, or other vendor source/assets are included.
