# HarnessScope V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build a runnable standalone HarnessScope V1 that ingests authorized evidence, redacts secrets before persistence, infers observable agent-harness behavior, compares sessions, exports clean-room specs, and provides a local desktop-style trace UI.

**Architecture:** Use a dependency-free Node.js 22 implementation for this executable V1 so it can be built and verified in the current environment. Keep the domain and CLI boundaries from the approved spec so a later Rust/Tauri port can preserve behavior without changing the evidence format or user workflow.

**Tech Stack:** Node.js 22 ESM, built-in `node:sqlite`, `node:test`, built-in HTTP server, HTML/CSS/JS UI.

**Spec:** `docs/superpowers/specs/2026-09-03-harnesscope-design.md`

## Global Constraints

- Standalone project; no QS3D dependency.
- Clean-room observation only; no auth bypass, TLS-pinning defeat, secret extraction, protected-binary source dumping, or vendor security-control disabling.
- Redact secrets before SQLite persistence.
- Inference must distinguish observed evidence from inference and unknowns.
- Raw evidence is append-only; findings are derived and point back to evidence ids.
- V1 must be runnable with Node.js 22 and no third-party package install.

---

### Task 1: Domain model, redaction, and SQLite store

**Files:**
- Create: `package.json`
- Create: `src/core/redact.mjs`
- Create: `src/core/store.mjs`
- Test: `test/redact.test.mjs`
- Test: `test/store.test.mjs`

**Interfaces:**
- Produces: `redactValue(value)`, `openWorkspace(path)`, `createSession(db, name, mode)`, `appendEvent(db, event)`, `listEvents(db, sessionId)`, `replaceFindings(db, sessionId, findings)`.

- [x] Write redaction tests and verify RED.
- [x] Implement minimal redaction and verify GREEN.
- [x] Write SQLite store tests and verify RED.
- [x] Implement schema/session/event/finding persistence and verify GREEN.
- [x] Commit.

### Task 2: Evidence importers

**Files:**
- Create: `src/importers/har.mjs`
- Create: `src/importers/procmon.mjs`
- Create: `src/importers/jsonl.mjs`
- Create: `src/core/csv.mjs`
- Test: `test/importers.test.mjs`
- Create: `fixtures/sample.har`
- Create: `fixtures/sample-procmon.csv`
- Create: `fixtures/sample.jsonl`
- Create: `fixtures/sample-map.yaml`

**Interfaces:**
- Produces: `importHar(path)`, `importProcmon(path)`, `importJsonl(path, mapPath)` returning normalized events.

- [x] Write fixture-based importer tests and verify RED.
- [x] Implement HAR redacted HTTP events and verify GREEN.
- [x] Implement CSV parser + Procmon normalization and verify GREEN.
- [x] Implement JSONL + small YAML mapping parser and verify GREEN.
- [x] Commit.

### Task 3: Harness inference and comparison

**Files:**
- Create: `src/core/infer.mjs`
- Create: `src/core/compare.mjs`
- Test: `test/infer.test.mjs`
- Test: `test/compare.test.mjs`

**Interfaces:**
- Produces: `inferFindings(events)`, `compareSessions(a, b)`.

- [x] Write tests for skill-loading, permission-gate, execution-loop, context/resume and persistence findings; verify RED.
- [x] Implement deterministic inference with confidence/evidence ids; verify GREEN.
- [x] Write session-diff test and verify RED.
- [x] Implement capability/category diff and verify GREEN.
- [x] Commit.

### Task 4: Clean-room exporter

**Files:**
- Create: `src/core/exporter.mjs`
- Test: `test/exporter.test.mjs`

**Interfaces:**
- Produces: `exportSession({db, sessionId, outDir})` creating `harness-spec.md`, `harness-spec.json`, and tool schemas when observed.

- [x] Write deterministic export + no-secret tests and verify RED.
- [x] Implement atomic temp-dir export and verify GREEN.
- [x] Commit.

### Task 5: Process/file observation and CLI

**Files:**
- Create: `src/observe/launch.mjs`
- Create: `src/observe/watch-files.mjs`
- Create: `src/cli.mjs`
- Create: `bin/harnesscope.mjs`
- Create: `fixtures/dummy-agent.mjs`
- Test: `test/cli.integration.test.mjs`

**Interfaces:**
- CLI: `session new`, `launch`, `watch-files`, `import`, `timeline`, `infer`, `compare`, `export`, `ui`.

- [x] Write CLI integration test around dummy agent and verify RED.
- [x] Implement command parser/session/import/infer/export flow and verify GREEN.
- [x] Implement owned-process launch observation and metadata-only file watcher.
- [x] Commit.

### Task 6: Desktop-style local UI

**Files:**
- Create: `src/ui/server.mjs`
- Create: `ui/index.html`
- Create: `ui/app.js`
- Create: `ui/styles.css`
- Test: `test/ui.test.mjs`

**Interfaces:**
- `startUiServer({dbPath, port})` serves trace/spec/session JSON endpoints and static UI.

- [x] Write HTTP API test and verify RED.
- [x] Implement server endpoints and verify GREEN.
- [x] Build trace grouping, session sidebar, Trace/Spec tabs, event inspector, filters and finding confidence display.
- [x] Commit.

### Task 7: Documentation, smoke verification, package

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Create: `docs/CLAUDE-OBSERVATION-TUTORIAL.md`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: documented runnable repo and ZIP archive.

- [x] Document authorization and clean-room boundaries plus quick start.
- [x] Document user-exported HAR/Procmon/JSONL workflow for Claude Code/Desktop without secret capture or security bypass.
- [x] Add Linux/Windows Node 22 CI.
- [x] Run full `npm test` and end-to-end CLI smoke.
- [x] Commit and archive source repo.
