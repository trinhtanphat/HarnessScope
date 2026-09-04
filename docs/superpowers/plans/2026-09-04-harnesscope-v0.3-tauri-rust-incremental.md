# HarnessScope v0.3 Tauri + Incremental Rust Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship HarnessScope v0.3.0 with Tauri as the preferred Windows/macOS desktop runtime and a Rust implementation of the deterministic/privileged core, while preserving the v0.2 workspace, renderer action contract, clean-room boundaries, Node CLI, and Electron fallback.

**Architecture:** Add a Rust workspace whose `harnesscope-core` crate is framework-independent and whose behavior is continuously checked against the released Node implementation through canonical parity fixtures. Add a thin Tauri shell that exposes only the existing v0.2 desktop action families to the shared renderer, keep Electron isolated under `apps/desktop`, and make v0.3 publication fail closed on exact-head Node, Rust, parity, Windows Tauri, and macOS Tauri gates.

**Tech Stack:** Node.js 22; Rust 1.98.1; Tauri 2.11.5; `@tauri-apps/cli` 2.11.4; `tauri-build` 2.6.3; `tauri-plugin-dialog` 2.7.3; `rusqlite` 0.40.2 with bundled SQLite; `serde` 1.0.229; `serde_json` 1.0.151; `thiserror` 2.0.20; `regex` 1.13.1; `uuid` 1.26.0; `tempfile` 3.27.0; `url` 2.5.8; `csv` 1.4.0; `time` 0.3.55; `sysinfo` 0.39.6; `node:test`; GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-04-harnesscope-v0.3-tauri-rust-incremental-design.md`

## Global Constraints

- Release version is exactly `0.3.0`; release tag is exactly `v0.3.0`.
- Rust toolchain is pinned by `rust-toolchain.toml` to `1.98.1` with `rustfmt` and `clippy` components.
- Tauri runtime is `2.11.5`; Tauri npm CLI is `2.11.4`; native dialog plugin is `2.7.3`.
- Existing Node CLI remains supported and existing Node tests remain green on Ubuntu, Windows, and macOS.
- Existing Electron source remains buildable and Electron-only imports remain under `apps/desktop`.
- The v0.2 SQLite schema, identifiers, event semantics, finding semantics, and clean-room export format remain the compatibility reference unless a separately documented behavior correction is approved.
- Sensitive values are redacted before persistence. Sentinel-secret tests must inspect persisted SQLite bytes.
- Renderer feature code never receives unrestricted shell, process, filesystem, SQLite, Electron, or Tauri APIs.
- Workspace writers use one cross-runtime lock protocol: atomic `<workspace.sqlite>.lock` directory, 5-second heartbeat, 30-second stale threshold, PID-liveness verification before stale reclamation, and owner-token validation on release.
- A lock is never reclaimed merely because it is old. If the recorded PID is still alive, or owner liveness cannot be established safely, acquisition fails closed with `WORKSPACE_LOCKED`.
- No authentication bypass, TLS-pinning bypass, credential extraction, memory scraping, protected-source dumping, or vendor security-control bypass is introduced.
- Windows and macOS v0.3 packages are intentionally unsigned.
- Required Windows release assets: `HarnessScope-0.3.0-windows-x64-Setup.exe`, `HarnessScope-0.3.0-windows-x64.msi`, `HarnessScope-0.3.0-windows-x64-portable.zip`.
- Required macOS release assets: `HarnessScope-0.3.0-macos-universal.dmg`, `HarnessScope-0.3.0-macos-universal.app.zip`.
- No v0.3 tag or GitHub Release is created before exact-head required CI and native package gates are green.

---

### Task 1: Rust workspace, pinned toolchain, canonical models, and parity transport

**Files:**
- Create: `rust-toolchain.toml`
- Create: `Cargo.toml`
- Create: `crates/harnesscope-core/Cargo.toml`
- Create: `crates/harnesscope-core/src/lib.rs`
- Create: `crates/harnesscope-core/src/model.rs`
- Create: `crates/harnesscope-parity/Cargo.toml`
- Create: `crates/harnesscope-parity/src/main.rs`
- Create: `scripts/parity-node.mjs`
- Create: `fixtures/parity/model-roundtrip.json`
- Modify: `package.json`
- Modify: `test/desktop-package.test.mjs`
- Test: `test/v03-toolchain-contract.test.mjs`

**Interfaces:**
- Produces Rust `Session`, `TraceEventInput`, `TraceEvent`, `Finding`, `SessionSnapshot`, `CompareResult`, and `OperationEnvelope<T>` with camelCase Serde names matching Node JSON.
- `TraceEventInput` has `id: Option<String>`, `timestamp_utc: Option<String>`, `source: String`, `kind: String`, `correlation_id: Option<String>`, `data: serde_json::Value`, and `redaction: Option<String>`; the store attaches `session_id` and fills missing IDs/timestamps.
- Produces `scripts/parity-node.mjs <case> <fixture>` that writes one canonical JSON result to stdout and no diagnostic text to stdout.
- Produces `cargo run -p harnesscope-parity -- <case> <fixture>` with the same stdout contract.

- [ ] **Step 1: Write the failing toolchain/shape contract test.** Assert `rust-toolchain.toml` contains `channel = "1.98.1"`, the initial root Cargo workspace contains only the two crates created in this task (`crates/harnesscope-core`, `crates/harnesscope-parity`), `package.json.version` is `0.3.0`, `@tauri-apps/cli` is exactly `2.11.4`, and Electron fallback dependencies/scripts are still present.

```js
assert.equal(pkg.version, '0.3.0');
assert.equal(pkg.devDependencies['@tauri-apps/cli'], '2.11.4');
assert.equal(pkg.devDependencies.electron, '44.1.0');
assert.equal(pkg.devDependencies['electron-builder'], '26.15.3');
assert.match(toolchain, /channel\s*=\s*"1\.98\.1"/);
assert.match(workspace, /crates\/harnesscope-core/);
assert.match(workspace, /crates\/harnesscope-parity/);
assert.doesNotMatch(workspace, /apps\/tauri\/src-tauri/);
```

- [ ] **Step 2: Run the new contract test and verify RED.**

Run: `node --test test/v03-toolchain-contract.test.mjs`

Expected: failure because the Rust workspace and v0.3 package metadata do not exist yet.

- [ ] **Step 3: Create the pinned Rust workspace and model types.** Root workspace dependencies are fixed here so later tasks do not add conditional dependencies:

```toml
[workspace]
resolver = "2"
members = [
  "crates/harnesscope-core",
  "crates/harnesscope-parity"
]

[workspace.dependencies]
serde = { version = "=1.0.229", features = ["derive"] }
serde_json = "=1.0.151"
thiserror = "=2.0.20"
regex = "=1.13.1"
uuid = { version = "=1.26.0", features = ["v4", "serde"] }
rusqlite = { version = "=0.40.2", features = ["bundled"] }
tempfile = "=3.27.0"
url = "=2.5.8"
csv = "=1.4.0"
time = { version = "=0.3.55", features = ["formatting", "parsing", "macros"] }
sysinfo = "=0.39.6"
```

`model.rs` must use camelCase serialization:

```rust
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TraceEvent {
    pub id: String,
    pub session_id: String,
    pub timestamp_utc: String,
    pub source: String,
    pub kind: String,
    pub correlation_id: Option<String>,
    pub data: serde_json::Value,
    pub redaction: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TraceEventInput {
    pub id: Option<String>,
    pub timestamp_utc: Option<String>,
    pub source: String,
    pub kind: String,
    pub correlation_id: Option<String>,
    pub data: serde_json::Value,
    pub redaction: Option<String>,
}
```

- [ ] **Step 4: Update V0.2 package tests for the V0.3 fallback contract.** Change `test/desktop-package.test.mjs` to expect package version `0.3.0`, keep exact Electron/electron-builder pins and Electron scripts, and keep ASAR/security/package target checks. Do not require V0.2 as the package version after the repository enters V0.3 development.

- [ ] **Step 5: Add the parity transport skeleton.** `scripts/parity-node.mjs` handles `model-roundtrip` by reading `fixtures/parity/model-roundtrip.json` and writing `JSON.stringify(value)`. The Rust parity binary handles the same case by deserializing into canonical model types and serializing back to one compact JSON line.

- [ ] **Step 6: Run baseline verification.**

```bash
npm install --no-audit --no-fund
npm test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Expected: all commands exit 0 and `package-lock.json` plus `Cargo.lock` are generated and committed.

- [ ] **Step 7: Commit.**

```bash
git add rust-toolchain.toml Cargo.toml Cargo.lock crates scripts/parity-node.mjs fixtures/parity/model-roundtrip.json package.json package-lock.json test/desktop-package.test.mjs test/v03-toolchain-contract.test.mjs
git commit -m "feat: add Rust workspace and parity contract"
```

### Task 2: Rust redaction parity and persisted-secret boundary

**Files:**
- Create: `crates/harnesscope-core/src/redact.rs`
- Create: `crates/harnesscope-core/tests/redact.rs`
- Create: `fixtures/parity/redaction.json`
- Modify: `crates/harnesscope-core/src/lib.rs`
- Modify: `scripts/parity-node.mjs`
- Modify: `crates/harnesscope-parity/src/main.rs`
- Test: `test/v03-parity-redaction.test.mjs`

**Interfaces:**
- Produces `pub fn redact_value(value: &serde_json::Value, key_hint: &str) -> RedactionResult`.
- `RedactionResult` is `{ value: Value, redacted: bool }` serialized as camelCase.
- Uses the already-pinned `url = 2.5.8` dependency for URL query parsing.
- Compatibility rules are exactly the Node `src/core/redact.mjs` sensitive-key regex, provider token families, Bearer token handling, recursive arrays/objects, and sensitive URL query parameter replacement.

- [ ] **Step 1: Write RED parity tests.** Include nested `Authorization`, `api_key`, `cookie`, URL `token=`, a GitHub-style `ghp_...` token, a Bearer token, safe values, and arrays. Assert both Node and Rust canonical JSON outputs are deeply equal and none of the sentinel strings appear.

- [ ] **Step 2: Run focused tests and verify RED.**

```bash
node --test test/v03-parity-redaction.test.mjs
cargo test -p harnesscope-core --test redact
```

Expected: RED because `redact.rs` and the Rust parity case are absent.

- [ ] **Step 3: Implement `redact.rs`.** Compile sensitive-key/token regexes once with `OnceLock<Regex>`, recurse through `serde_json::Value`, parse URL strings with `url::Url`, redact sensitive query parameters, and return `[REDACTED]` without retaining matched secret substrings in the returned value.

- [ ] **Step 4: Extend both parity runners with `redaction`.** Node calls `redactValue`; Rust calls `redact_value` on the same fixture items and outputs an array of `RedactionResult`.

- [ ] **Step 5: Verify GREEN and full regression.**

```bash
node --test test/redact.test.mjs test/v03-parity-redaction.test.mjs
cargo test -p harnesscope-core --test redact
npm test
cargo test --workspace
```

- [ ] **Step 6: Commit.**

```bash
git add crates/harnesscope-core scripts/parity-node.mjs crates/harnesscope-parity fixtures/parity/redaction.json test/v03-parity-redaction.test.mjs
git commit -m "feat: port redaction to Rust with parity"
```

### Task 3: SQLite v0.2 compatibility and shared workspace lock protocol

**Files:**
- Create: `crates/harnesscope-core/src/store.rs`
- Create: `crates/harnesscope-core/src/lock.rs`
- Create: `crates/harnesscope-core/tests/store.rs`
- Create: `crates/harnesscope-core/tests/workspace_lock.rs`
- Create: `scripts/make-v02-workspace-fixture.mjs`
- Create: `fixtures/v02-workspace/README.md`
- Create binary fixture during execution: `fixtures/v02-workspace/workspace.sqlite`
- Create: `src/core/workspace-lock.mjs`
- Modify: `src/core/store.mjs`
- Modify: `apps/desktop/main.mjs`
- Modify: `apps/desktop/services.mjs`
- Modify: `src/ui/server.mjs`
- Modify: `src/cli.mjs`
- Test: `test/workspace-lock.test.mjs`
- Test: `test/v03-store-compat.test.mjs`

**Interfaces:**
- Rust `Workspace::open(path: impl AsRef<Path>) -> Result<Workspace, CoreError>` opens the existing v0.2 schema with WAL and foreign keys enabled. It is a low-level database primitive; desktop/server/CLI writer entrypoints acquire the application lock before calling it.
- Rust methods `create_session`, `get_session`, `list_sessions`, `append_event`, `append_events`, `list_events`, `replace_findings`, `list_findings` mirror Node JSON field names.
- `append_event(&self, session_id: &str, input: TraceEventInput) -> Result<TraceEvent, CoreError>` attaches `sessionId`, generates missing ID/timestamp, and redacts before INSERT.
- Lock path is exactly `<absolute db path>.lock` as a directory.
- Owner metadata is `<lockdir>/owner.json` with `{ "token", "pid", "runtime", "processStartIdentity", "acquiredUtc", "heartbeatUtc" }`. `processStartIdentity` may be `null` when the runtime cannot obtain one safely.
- Heartbeat interval is 5 seconds and stale threshold is 30 seconds.

- [ ] **Step 1: Generate a committed v0.2 fixture DB from the released Node schema.** `scripts/make-v02-workspace-fixture.mjs` creates a session with fixed IDs/timestamps, one redacted event, one finding/evidence pair, closes SQLite, and writes `fixtures/v02-workspace/workspace.sqlite`. The fixture README records that it is generated by the Node v0.2-compatible `store.mjs` and contains synthetic data only.

- [ ] **Step 2: Write failing Rust store tests.** Open the committed DB, assert exact session/event/finding fields, append a second session/event, close/reopen, and assert persistence. Add a sentinel secret event and inspect database bytes after close to prove the sentinel is absent.

- [ ] **Step 3: Implement Rust `Workspace`.** Use the existing SQL schema verbatim. Generate RFC3339 UTC timestamps with pinned `time 0.3.55`. `append_event` calls Rust redaction before INSERT. `append_events` and `replace_findings` use transactions and roll back on error.

- [ ] **Step 4: Write failing cross-runtime lock tests.** Node and Rust tests must prove: first owner acquires; second owner returns `WORKSPACE_LOCKED`; heartbeat refreshes every 5 seconds; an old lock whose PID is still alive is not reclaimed; an old lock whose PID is confirmed absent can be atomically renamed/reclaimed; liveness-check errors fail closed; release removes only a lock whose owner token matches.

- [ ] **Step 5: Implement owner liveness and shared lock state machine.** Node uses `process.kill(pid, 0)` as the PID existence check; `ESRCH` means absent, success/`EPERM` means potentially live, and any unknown platform error fails closed. Rust uses pinned `sysinfo 0.39.6` to refresh/check the recorded PID; unsupported-system or refresh uncertainty fails closed. The reclaim algorithm is fixed:

```text
mkdir <db>.lock atomically
  success -> write owner.json atomically -> start 5s heartbeatUtc updates
  EEXIST -> read owner.json
    valid heartbeat age <= 30s -> WORKSPACE_LOCKED
    heartbeat age > 30s -> verify recorded PID
      PID live/unknown -> WORKSPACE_LOCKED
      PID confirmed absent -> rename lock dir to <db>.lock.stale-<uuid>
                              retry mkdir
                              delete renamed stale dir only after new ownership succeeds
release -> re-read owner.json; remove only if token equals this owner's token
```

Malformed/missing owner metadata always fails closed and requires user/manual recovery; it is never deleted automatically because no owner PID can be verified.

- [ ] **Step 6: Integrate Node writer lifecycles.** Electron main and browser UI server acquire one lock for their process lifetime and release on clean shutdown. One-shot CLI commands that can write acquire before opening and release in `finally`. Low-level `openWorkspace` stays lock-agnostic so existing in-process tests can use temporary databases without nested lock acquisition. Electron service operations reuse the lease owned by Electron main.

- [ ] **Step 7: Verify.**

```bash
npm test
cargo test -p harnesscope-core --test store --test workspace_lock
cargo test --workspace
```

Expected: all existing Node tests plus new compatibility/lock tests pass; the committed v0.2 fixture remains readable; sentinel secrets are absent from persisted bytes.

- [ ] **Step 8: Commit.**

```bash
git add crates/harnesscope-core src/core/store.mjs src/core/workspace-lock.mjs src/ui/server.mjs src/cli.mjs apps/desktop/main.mjs apps/desktop/services.mjs scripts/make-v02-workspace-fixture.mjs fixtures/v02-workspace test/workspace-lock.test.mjs test/v03-store-compat.test.mjs
git commit -m "feat: add compatible Rust store and workspace locking"
```

### Task 4: Rust inference and comparison with canonical Node parity

**Files:**
- Create: `crates/harnesscope-core/src/infer.rs`
- Create: `crates/harnesscope-core/src/compare.rs`
- Create: `crates/harnesscope-core/tests/infer.rs`
- Create: `crates/harnesscope-core/tests/compare.rs`
- Create: `fixtures/parity/inference.json`
- Create: `fixtures/parity/compare.json`
- Modify: `crates/harnesscope-core/src/lib.rs`
- Modify: `scripts/parity-node.mjs`
- Modify: `crates/harnesscope-parity/src/main.rs`
- Test: `test/v03-parity-inference.test.mjs`
- Test: `test/v03-parity-compare.test.mjs`

**Interfaces:**
- Produces `pub fn infer_findings(events: &[TraceEvent]) -> Vec<Finding>`.
- Produces `pub fn compare_sessions(a: &SessionSnapshot, b: &SessionSnapshot) -> CompareResult`.
- Finding categories, confidences, statements, evidence order, and result sorting must match the Node implementation for canonical fixtures.

- [ ] **Step 1: Write inference parity RED tests using the existing inference scenario.** Fixture contains SkillRead, InstructionRead, PermissionPrompt/Decision, correlated ToolCall/ToolResult pairs, FileWritten, CompactionMarker, ProcessExited/Started, FileRead, and ResumeMarker. Do not normalize category, confidence, title, statement, or evidence IDs; findings generated by inference do not require persistent IDs before `replaceFindings`.

- [ ] **Step 2: Port inference rules literally.** Preserve sort by `timestampUtc`, permission correlation behavior, tool argument key sorting, confidence formulas, execution-loop thresholds, explicit-context-only rule, restart-persistence detection, and final confidence-desc/title-asc sort.

- [ ] **Step 3: Write compare parity RED tests and port compare semantics.** Preserve sorted unique event kinds, tool names, finding categories, shared sets, and only-A/only-B sets.

- [ ] **Step 4: Extend parity runners for `inference` and `compare`.** Both runners read identical JSON fixtures and emit canonical JSON without runtime-generated timestamps.

- [ ] **Step 5: Verify.**

```bash
node --test test/infer.test.mjs test/compare.test.mjs test/v03-parity-inference.test.mjs test/v03-parity-compare.test.mjs
cargo test -p harnesscope-core --test infer --test compare
npm test
cargo test --workspace
```

- [ ] **Step 6: Commit.**

```bash
git add crates/harnesscope-core crates/harnesscope-parity scripts/parity-node.mjs fixtures/parity/inference.json fixtures/parity/compare.json test/v03-parity-inference.test.mjs test/v03-parity-compare.test.mjs
git commit -m "feat: port inference and compare to Rust"
```

### Task 5: Rust HAR/Procmon/JSONL importers and deterministic exporter

**Files:**
- Create: `crates/harnesscope-core/src/import/mod.rs`
- Create: `crates/harnesscope-core/src/import/har.rs`
- Create: `crates/harnesscope-core/src/import/procmon.rs`
- Create: `crates/harnesscope-core/src/import/jsonl.rs`
- Create: `crates/harnesscope-core/src/export.rs`
- Create: `crates/harnesscope-core/tests/importers.rs`
- Create: `crates/harnesscope-core/tests/export.rs`
- Modify: `crates/harnesscope-core/src/lib.rs`
- Modify: `scripts/parity-node.mjs`
- Modify: `crates/harnesscope-parity/src/main.rs`
- Test: `test/v03-parity-import-export.test.mjs`

**Interfaces:**
- `import_har(path: &Path) -> Result<Vec<TraceEventInput>, CoreError>`.
- `import_procmon(path: &Path, date: &str) -> Result<Vec<TraceEventInput>, CoreError>`.
- `import_jsonl(path: &Path, map_path: &Path) -> Result<Vec<TraceEventInput>, CoreError>`.
- `export_session(workspace: &Workspace, session_id: &str, out_dir: &Path) -> Result<ExportResult, CoreError>`.
- Export format remains `harnesscope.cleanroom-spec.v1` because the behavioral format is unchanged.

- [ ] **Step 1: Write importer parity RED tests against `fixtures/sample.har`, `fixtures/sample-procmon.csv`, `fixtures/sample.jsonl`, and `fixtures/sample-map.yaml`.** Replace only importer-generated random HAR correlation UUIDs with deterministic positional placeholders before equality comparison; compare kind/source/data/redaction/timestamp semantics exactly.

- [ ] **Step 2: Implement HAR importer.** Preserve request/response pair ordering, headers-to-object behavior, JSON-or-string body parsing, MIME fields, same timestamp for the pair, and redaction before returning event inputs.

- [ ] **Step 3: Implement Procmon importer with the already-pinned `csv 1.4.0`.** Preserve Process Create/Exit, ReadFile, WriteFile, rename mapping, PID conversion, child PID parsing, command-line extraction, and UTC timestamp formatting.

- [ ] **Step 4: Implement JSONL importer.** Preserve the deliberately small flat YAML mapping grammar from Node instead of introducing a general YAML parser: ignore blank/comment lines, split on the first `:`, trim one layer of quotes, resolve dotted object paths, and canonicalize the same known event names.

- [ ] **Step 5: Write exporter parity RED test.** Create the same fixed-ID session/event/finding in Node and Rust temporary workspaces, export both, compare exact `harness-spec.json`, exact `harness-spec.md`, and exact tool-schema contents. Paths may differ; exported file contents may not.

- [ ] **Step 6: Implement deterministic Rust exporter.** Preserve stable object-key ordering, observed tool type discovery, finding thresholds (`>=0.9 INFERRED_HIGH`, `>=0.7 INFERRED_MEDIUM`, else `UNKNOWN`), sorted evidence IDs in JSON, Markdown wording, safe tool filename replacement, temporary-directory write, and final atomic rename.

- [ ] **Step 7: Verify.**

```bash
node --test test/importers.test.mjs test/exporter.test.mjs test/v03-parity-import-export.test.mjs
cargo test -p harnesscope-core --test importers --test export
npm test
cargo test --workspace
```

- [ ] **Step 8: Commit.**

```bash
git add crates/harnesscope-core crates/harnesscope-parity scripts/parity-node.mjs test/v03-parity-import-export.test.mjs
git commit -m "feat: port import and export pipeline to Rust"
```

### Task 6: Rust owned-process observation and application services

**Files:**
- Create: `crates/harnesscope-core/src/observe/mod.rs`
- Create: `crates/harnesscope-core/src/observe/launch.rs`
- Create: `crates/harnesscope-core/src/observe/files.rs`
- Create: `crates/harnesscope-core/src/services.rs`
- Create: `crates/harnesscope-core/src/error.rs`
- Create: `crates/harnesscope-core/tests/observe.rs`
- Create: `crates/harnesscope-core/tests/services.rs`
- Modify: `crates/harnesscope-core/src/lib.rs`

**Interfaces:**
- Define `LaunchRequest { target: String, args: Vec<String>, cwd: Option<PathBuf> }` and `LaunchResult { pid: u32, exit_code: Option<i32>, signal: Option<String>, events_captured: usize }`.
- Define `WatchRequest { path: PathBuf, seconds: u64, interval_ms: u64 }` and `WatchResult { path: PathBuf, events_captured: usize, seconds: u64 }`.
- `launch_target(workspace: &Workspace, session_id: &str, request: LaunchRequest) -> Result<LaunchResult, CoreError>`.
- `watch_files(workspace: &Workspace, session_id: &str, request: WatchRequest) -> Result<WatchResult, CoreError>`.
- `AppServices` methods correspond one-for-one to Electron services: `app_info`, `workspace_info`, `session_list`, `session_create`, `timeline_get`, `inference_run`, `compare_run`, `import_har`, `import_procmon`, `import_jsonl`, `launch_run`, `export_run`.
- `CoreError` stable codes include `WORKSPACE_LOCKED`, `SESSION_NOT_FOUND`, `IMPORT_INVALID_FILE`, `LAUNCH_FAILED`, `EXPORT_FAILED`, `INVALID_ARGUMENT`.

- [ ] **Step 1: Write failing launcher tests using `fixtures/dummy-agent.mjs`.** Assert `ProcessStarted` and `ProcessExited` are persisted, structured stdout lines prefixed `HARNESSCOPE_EVENT ` are parsed, arbitrary stdout/stderr is not persisted, malformed structured markers store only the safe diagnostic, and the launcher waits until stdout/stderr reader threads are joined before returning.

- [ ] **Step 2: Implement `launch.rs`.** Use `std::process::Command` with piped stdout/stderr, reader threads for complete pipe drain, ignore ordinary lines, parse only `HARNESSCOPE_EVENT ` JSON, append through `Workspace`, join readers before `ProcessExited` return, and never enumerate or terminate unrelated processes.

- [ ] **Step 3: Write and implement metadata-only file observation.** Snapshot recursively with `std::fs::read_dir`; persist only path, size, mtime, and `contentCaptured: false`; never read file contents. Match v0.2 polling semantics with a 500ms default interval.

- [ ] **Step 4: Write service-layer tests.** Use temporary locked workspaces and explicit file paths rather than GUI dialogs. Prove session create/list/timeline/inference/compare/import/launch/export return serializable values and stable error codes.

- [ ] **Step 5: Implement `AppServices`.** Desktop services own one `WorkspaceLease` plus one `Workspace` for application lifetime. File-dialog selection remains the Tauri adapter's responsibility; core services accept selected paths explicitly.

- [ ] **Step 6: Verify.**

```bash
cargo test -p harnesscope-core --test observe --test services
cargo clippy --workspace --all-targets -- -D warnings
npm test
cargo test --workspace
```

- [ ] **Step 7: Commit.**

```bash
git add crates/harnesscope-core
git commit -m "feat: add Rust observation and application services"
```

### Task 7: Tauri shell, least-privilege commands, dialogs, and shared renderer adapter

**Files:**
- Create: `apps/tauri/README.md`
- Create: `apps/tauri/src-tauri/Cargo.toml`
- Create: `apps/tauri/src-tauri/build.rs`
- Create: `apps/tauri/src-tauri/tauri.conf.json`
- Create: `apps/tauri/src-tauri/capabilities/main.json`
- Create: `apps/tauri/src-tauri/src/main.rs`
- Create: `apps/tauri/src-tauri/src/commands.rs`
- Create: `apps/tauri/src-tauri/src/state.rs`
- Create: `apps/tauri/src-tauri/src/errors.rs`
- Create: `ui/tauri-bridge.js`
- Modify: `ui/data-client.js`
- Modify: `ui/index.html`
- Modify: `Cargo.toml`
- Modify: `package.json`
- Test: `test/v03-tauri-contract.test.mjs`
- Modify: `test/ui-data-client.test.mjs`

**Interfaces:**
- Tauri crate package name is exactly `harnesscope-tauri` so CI can run `cargo check -p harnesscope-tauri`.
- Tauri command names are exactly `app_info`, `workspace_info`, `session_list`, `session_create`, `timeline_get`, `inference_run`, `compare_run`, `import_har`, `import_procmon`, `import_jsonl`, `launch_run`, `export_run`, `dialog_pick_directory`, `dialog_pick_file`.
- `createTauriBridge(tauri)` exposes the same JavaScript shape as Electron `window.harnesscope`: `app.info`, `workspace.info`, `session.list/create`, `timeline.get`, `inference.run`, `compare.run`, `import.har/procmon/jsonl`, `launch.run`, `export.run`, `dialog.pickDirectory/pickFile`.
- All commands return `{ ok:true, value }` or `{ ok:false, code, message }` envelopes.

- [ ] **Step 1: Write Tauri static contract RED test.** Assert root workspace adds `apps/tauri/src-tauri`; crate pins `tauri = =2.11.5`, `tauri-build = =2.6.3`, `tauri-plugin-dialog = =2.7.3`; invoke handler lists exactly the documented commands; config has `app.withGlobalTauri = true` for the vanilla-JS renderer; CSP is explicit; no shell or filesystem plugin is installed; capability grants only main-window core/dialog permissions required by the app.

- [ ] **Step 2: Create Tauri crate/config.** Add `apps/tauri/src-tauri` to root workspace. Tauri config uses product name `HarnessScope`, identifier `com.trinhtanphat.harnesscope`, version `0.3.0`, `frontendDist: "../../../ui"`, `withGlobalTauri: true`, one main window, CSP `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost`, and bundle targets `nsis`, `msi`, `dmg`, `app`.

`apps/tauri/src-tauri/Cargo.toml` must include:

```toml
[package]
name = "harnesscope-tauri"
version = "0.3.0"
edition = "2024"

[build-dependencies]
tauri-build = "=2.6.3"

[dependencies]
harnesscope-core = { path = "../../../crates/harnesscope-core" }
tauri = "=2.11.5"
tauri-plugin-dialog = "=2.7.3"
serde.workspace = true
serde_json.workspace = true
```

- [ ] **Step 3: Implement managed state and command wrappers.** On setup, compute app-data `HarnessScope/workspace.sqlite`, acquire `WorkspaceLease`, construct `AppServices`, and manage it in Tauri state. Command handlers validate primitive strings/arrays before calling services and translate `CoreError` to safe envelopes.

- [ ] **Step 4: Implement native dialog commands with `tauri-plugin-dialog`.** Import file operations use fixed extension filters: HAR=`har`, Procmon=`csv`, JSONL=`jsonl|ndjson`, mapping=`yaml|yml`; export picks a directory. Backend-selected paths are passed directly to services and are not exposed as a generic filesystem command.

- [ ] **Step 5: Add `ui/tauri-bridge.js` and update the data client using Tauri's documented vanilla-JS global API.** Tauri detection is `globalThis.__TAURI__?.core?.invoke`. Runtime selection order is Tauri first, Electron second, browser third. Feature code never calls `window.__TAURI__` outside `ui/tauri-bridge.js`.

```js
export function createTauriBridge(tauri = globalThis.__TAURI__) {
  const invoke = tauri?.core?.invoke;
  if (typeof invoke !== 'function') return null;
  // return the frozen v0.2-compatible bridge shape using invoke(command, args)
}
```

`ui/data-client.js` receives the selected bridge rather than reading Tauri internals directly.

- [ ] **Step 6: Add Tauri package scripts without removing Electron scripts.** Required additions:

```json
{
  "tauri": "tauri",
  "tauri:dev": "tauri dev --config apps/tauri/src-tauri/tauri.conf.json",
  "tauri:win": "tauri build --config apps/tauri/src-tauri/tauri.conf.json --target x86_64-pc-windows-msvc --bundles nsis,msi",
  "tauri:mac": "tauri build --config apps/tauri/src-tauri/tauri.conf.json --target universal-apple-darwin --bundles dmg,app"
}
```

- [ ] **Step 7: Verify.**

```bash
npm test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo check -p harnesscope-tauri
```

Expected: full Node/Rust tests green and Tauri backend compiles on the current host. Native bundle proof is performed by Task 8 on GitHub-hosted Windows/macOS runners.

- [ ] **Step 8: Commit.**

```bash
git add apps/tauri ui/tauri-bridge.js ui/data-client.js ui/index.html package.json package-lock.json test/v03-tauri-contract.test.mjs test/ui-data-client.test.mjs Cargo.toml Cargo.lock
git commit -m "feat: add secure Tauri desktop shell"
```

### Task 8: Cross-platform Node/Rust/parity/Tauri CI and native artifact gates

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `test/ci-contract.test.mjs`
- Modify: `test/desktop-package.test.mjs`
- Create: `test/v03-ci-contract.test.mjs`
- Create: `scripts/run-parity.mjs`
- Create: `scripts/package-windows-portable.ps1`
- Create: `scripts/package-macos-app.sh`

**Interfaces:**
- Required CI jobs: `node-test` matrix Ubuntu/Windows/macOS, `rust-core` matrix Ubuntu/Windows/macOS, `parity`, `tauri-windows`, `tauri-macos`.
- `parity` runs explicit cases `model-roundtrip`, `redaction`, `store`, `inference`, `compare`, `imports`, and `export` through `scripts/run-parity.mjs`; any canonical mismatch exits nonzero.
- Tauri package jobs depend on successful Node, Rust, and parity gates.
- Uploaded artifact names are `HarnessScope-0.3.0-windows-x64` and `HarnessScope-0.3.0-macos-universal`.

- [ ] **Step 1: Write RED static CI contract tests.** Assert Rust 1.98.1 setup, `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, Node tests on all three OSes, parity script execution, exact Windows/macOS Tauri build scripts, and non-empty artifact validation.

- [ ] **Step 2: Implement `scripts/run-parity.mjs`.** For each named case, spawn the Node runner and Rust parity binary on the same fixture, require exit code 0, parse their single-line JSON, recursively normalize only the nondeterministic fields allowed by the spec (temporary absolute root, generated PID, generated timestamp, generated HAR correlation UUID), then `assert.deepStrictEqual`. No semantic finding/tool/event/export fields are removed.

- [ ] **Step 3: Replace V0.2 package CI gates with V0.3 gates while preserving Electron source regression tests.** `node-test` runs `npm ci` then `npm test` on Ubuntu/Windows/macOS. `rust-core` installs pinned Rust and runs formatting, clippy, and tests. `parity` runs after Node/Rust. Windows/macOS package jobs depend on all gate families.

- [ ] **Step 4: Build Windows packages.** On `windows-latest`, install target `x86_64-pc-windows-msvc`, run `npm ci`, then `npm run tauri:win`. Normalize the Tauri outputs to:

```text
dist/tauri/HarnessScope-0.3.0-windows-x64-Setup.exe
dist/tauri/HarnessScope-0.3.0-windows-x64.msi
```

Create `HarnessScope-0.3.0-windows-x64-portable.zip` from the release executable plus `README-UNSIGNED.txt` with `Compress-Archive`; validate all three files have length > 0 before upload.

- [ ] **Step 5: Build universal macOS packages.** On `macos-latest`, install both `x86_64-apple-darwin` and `aarch64-apple-darwin`, run `npm ci`, then `npm run tauri:mac`. Normalize DMG to `dist/tauri/HarnessScope-0.3.0-macos-universal.dmg`, and archive the app with:

```bash
ditto -c -k --sequesterRsrc --keepParent \
  target/universal-apple-darwin/release/bundle/macos/HarnessScope.app \
  dist/tauri/HarnessScope-0.3.0-macos-universal.app.zip
```

Validate both files are non-empty.

- [ ] **Step 6: Run static/local proof, then use GitHub native runners for package proof.**

```bash
npm test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
node scripts/run-parity.mjs
```

Expected GitHub exact-head jobs: all five required job families conclude `success`.

- [ ] **Step 7: Commit.**

```bash
git add .github/workflows/ci.yml test/ci-contract.test.mjs test/desktop-package.test.mjs test/v03-ci-contract.test.mjs scripts/run-parity.mjs scripts/package-windows-portable.ps1 scripts/package-macos-app.sh
git commit -m "ci: add Rust parity and Tauri package gates"
```

### Task 9: v0.3 fail-closed release, documentation, PR, merge, tag, and release verification

**Files:**
- Create: `.github/workflows/release-v0.3.0.yml`
- Delete after V0.3 workflow exists and static tests target it: `.github/workflows/release-v0.2.0.yml`
- Modify: `test/release-contract.test.mjs`
- Modify: `README.md`
- Modify: `apps/tauri/README.md`
- Modify during execution: `docs/superpowers/plans/2026-09-04-harnesscope-v0.3-tauri-rust-incremental.md` checkboxes

**Interfaces:**
- Release trigger is a successful `workflow_run` of `ci` on branch `main`.
- `TARGET_SHA` is exactly `${{ github.event.workflow_run.head_sha }}` and every release job checks out that SHA.
- Release creates exactly seven public assets: three Windows, two macOS, source ZIP, `SHA256SUMS.txt`.

- [ ] **Step 1: Write release contract RED tests.** Required asset names:

```text
HarnessScope-0.3.0-windows-x64-Setup.exe
HarnessScope-0.3.0-windows-x64.msi
HarnessScope-0.3.0-windows-x64-portable.zip
HarnessScope-0.3.0-macos-universal.dmg
HarnessScope-0.3.0-macos-universal.app.zip
HarnessScope-0.3.0-source.zip
SHA256SUMS.txt
```

Assert successful-main-CI gating, exact SHA checkout in every job, package/Tauri version `0.3.0`, idempotent existing-tag guard, SHA256 generation, and `gh release create` only after both native package jobs succeed.

- [ ] **Step 2: Implement `release-v0.3.0.yml`.** Rebuild Windows and macOS Tauri packages independently on native runners from `TARGET_SHA`; never publish PR artifacts. Re-run `npm test`, formatting, clippy, Rust tests, and parity before packaging. Package jobs upload normalized exact assets. Release job builds source ZIP with `git archive`, downloads both native sets, checks each required asset is non-empty, writes `SHA256SUMS.txt`, and only then creates tag/release.

- [ ] **Step 3: Implement idempotent tag handling.** If `v0.3.0` exists, resolve its commit; mismatch with `TARGET_SHA` exits 1. If it matches, `gh release view v0.3.0` must succeed and the seven expected asset names must all be present; otherwise exit 1. Never rewrite an existing tag.

- [ ] **Step 4: Update README.** Make Tauri V0.3 the preferred desktop runtime, keep Node CLI and Electron fallback commands documented, list exact V0.3 artifacts, explain unsigned Windows SmartScreen and macOS Control-click → Open flows, and explicitly state HarnessScope does not require disabling Gatekeeper or system security controls.

- [ ] **Step 5: Run the complete pre-PR verification.**

```bash
npm ci
npm test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
node scripts/run-parity.mjs
```

Expected: zero test failures, zero clippy warnings, zero parity mismatches.

- [ ] **Step 6: Push/open PR from `feature/v0.3-tauri-rust-incremental` to `main`.** PR body lists the exact feature-head SHA and required CI gates. Do not merge while any required exact-head job is queued, in progress, cancelled, or failed.

- [ ] **Step 7: Merge only after exact-head PR CI is green.** Use a merge commit with expected head SHA. Verify `main` starts a fresh CI run whose `head_sha` is the merge commit and wait for Node, Rust, parity, Tauri Windows, and Tauri macOS jobs to all conclude `success`.

- [ ] **Step 8: Verify release workflow and public release.** Wait for `release-v0.3.0` on the exact successful `main` SHA. Confirm `package-windows`, `package-macos`, and `release` all conclude `success`. Fetch `releases/tags/v0.3.0`, verify `draft=false`, `prerelease=false`, tag resolves to the exact `main` SHA, and all seven assets are uploaded and non-empty.

- [ ] **Step 9: Final verification report.** Record final `main` SHA, PR number, main CI run ID, release workflow run ID, tag SHA, and release URL. Do not call V0.3 complete before all six values and the seven assets are verified from GitHub.
