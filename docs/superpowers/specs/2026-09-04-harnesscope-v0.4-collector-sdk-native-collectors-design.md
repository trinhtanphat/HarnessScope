# HarnessScope v0.4 — Collector SDK + Native macOS/Linux Collectors Design

## Status

Direction approved by user on 2026-09-04. This written specification is pending final user review before implementation planning.

## Goal

Ship HarnessScope `v0.4.0` with a stable, capability-bounded Collector SDK and first-party native process/file collectors for macOS and Linux, while preserving the released v0.3 clean-room, redaction, SQLite, Node/Rust parity, Tauri, CLI, and release contracts.

V0.4 makes collection extensible without turning collectors into privileged plugins with unrestricted application access. Every collector must emit the same canonical evidence model, declare its capabilities, obey authorization boundaries, and pass redaction before persistence.

## Why V0.4

V0.3 established the Rust core, Tauri desktop runtime, cross-runtime writer lock, parity, and fail-closed native release pipeline. The next highest-leverage step is to separate evidence acquisition from normalization/persistence so new collectors can be added without modifying the core or renderer for every source.

The original V1 design explicitly deferred:

- macOS/Linux native process collectors beyond portable fallback;
- a plugin SDK for custom evidence collectors;
- ETW high-volume collection;
- automated harness reimplementation/code generation.

V0.4 implements the first two only. ETW and harness generation remain deferred.

## Version and compatibility contract

- Product version becomes exactly `0.4.0`.
- Release tag is exactly `v0.4.0`.
- V0.3 workspaces remain readable and writable without destructive migration.
- Existing Node CLI commands remain supported.
- Existing Tauri and Electron action families remain compatible unless explicitly extended by additive collector actions.
- Existing event kinds, finding semantics, redaction-before-persistence rule, and clean-room exporter remain the compatibility reference.
- Existing v0.3 release artifacts remain immutable historical releases.
- V0.4 packages remain unsigned unless a separate signing design is approved.

## Non-goals

V0.4 does not:

- add Windows ETW high-volume collection;
- inject code into another process;
- scrape process memory;
- bypass authentication, access control, TLS pinning, sandboxing, SIP, Gatekeeper, SELinux, AppArmor, or other security controls;
- silently elevate privileges;
- capture secrets or credential stores;
- decompile or extract protected vendor source;
- add arbitrary in-process third-party native code loading to the desktop app;
- generate a replacement agent harness from findings.

## Architectural principles

### 1. Collectors are producers, not storage owners

Collectors never write SQLite directly. They produce canonical `TraceEventInput` records and structured diagnostics. The existing core owns redaction, IDs/timestamps when needed, persistence, findings, and export.

### 2. Capability declaration is mandatory

Every collector declares what it can observe before it runs. The application uses this manifest for UI presentation, authorization prompts, platform gating, and tests.

### 3. First-party native collectors share the SDK contract

The macOS and Linux collectors are not privileged special cases. They implement the same collector interface intended for future first-party or externally launched adapters.

### 4. Extension is out-of-process by default

V0.4 does not load arbitrary third-party dynamic libraries into HarnessScope. Custom collectors integrate through a versioned process/JSONL protocol. This keeps crashes, dependency conflicts, and permissions outside the core process and allows strict schema validation.

### 5. Fail closed on uncertain authority

When required metadata cannot be read safely, the collector emits an explicit unavailable/unknown diagnostic or omits that field. It does not escalate privileges or substitute invasive techniques.

## Component model

```text
Authorized target / selected paths
        |
        v
+-----------------------------+
| Collector implementation    |
| - macOS native              |
| - Linux native              |
| - external SDK adapter      |
+-----------------------------+
        |
        | CollectorEnvelope JSON
        v
+-----------------------------+
| Collector host / registry   |
| - manifest validation       |
| - lifecycle                 |
| - capability checks         |
| - bounded buffering         |
| - diagnostics               |
+-----------------------------+
        |
        | TraceEventInput
        v
+-----------------------------+
| Existing HarnessScope core  |
| redaction -> SQLite -> infer|
+-----------------------------+
        |
        +--> CLI
        +--> Tauri desktop
        +--> Electron fallback
```

## Collector SDK

### Package boundary

Add a framework-independent Rust module/crate for collector contracts. The exact crate split is chosen in the implementation plan, but the public conceptual interface is fixed by this design.

Core concepts:

- `CollectorManifest`
- `CollectorCapability`
- `CollectorConfigSchema`
- `CollectorStartRequest`
- `CollectorEnvelope`
- `CollectorDiagnostic`
- `CollectorHandle`
- `CollectorStatus`

### Collector manifest

A collector manifest is immutable metadata describing an implementation:

```json
{
  "sdkVersion": "1",
  "id": "harnesscope.macos.process-files",
  "name": "macOS Process + Files",
  "version": "0.4.0",
  "platforms": ["macos"],
  "capabilities": [
    "process.lifecycle",
    "process.metadata",
    "file.metadata"
  ],
  "requiresExplicitPaths": true,
  "requiresTargetLaunch": true,
  "contentCapture": "unsupported"
}
```

Rules:

- `sdkVersion` is required and V0.4 accepts only `1`.
- Collector IDs are stable reverse-DNS-style strings.
- Unknown capabilities are rejected for first-party collectors and ignored only in explicitly forward-compatible external manifest parsing where no action is authorized from them.
- A manifest cannot grant itself capabilities; runtime host policy is authoritative.

### Capabilities

V0.4 defines only the capabilities required by current product scope:

- `process.lifecycle` — start/exit and parent-child relationships where observable;
- `process.metadata` — executable identity, PID/PPID, command line when accessible through supported APIs;
- `file.metadata` — selected-path create/write/remove/rename metadata;
- `collector.diagnostics` — structured warnings/errors/status.

Reserved but not implemented in V0.4:

- `network.metadata`;
- `registry.metadata`;
- `kernel.trace`;
- `content.capture`.

### Lifecycle

A collector follows a bounded lifecycle:

```text
registered -> starting -> running -> stopping -> stopped
                    \-> failed
```

Required operations:

- list manifests;
- validate config;
- start;
- read/drain envelopes;
- query status;
- stop;

Starting an already-running collector with the same instance key returns a deterministic conflict error. Stop is idempotent after a terminal state.

### Envelope protocol

Every collector output is one versioned envelope:

```json
{
  "sdkVersion": "1",
  "collectorId": "harnesscope.linux.process-files",
  "instanceId": "...",
  "sequence": 42,
  "kind": "event",
  "event": {
    "source": "collector",
    "kind": "ProcessStarted",
    "correlationId": "pid:1234",
    "data": {}
  }
}
```

Envelope `kind` is one of:

- `event` — contains one canonical `TraceEventInput`;
- `diagnostic` — contains a structured diagnostic;
- `heartbeat` — proves collector liveness without creating a trace event;
- `completed` — terminal clean completion marker.

Rules:

- `sequence` is monotonically increasing per collector instance.
- Duplicate sequence values are rejected.
- Out-of-order values fail the collector instance rather than silently reorder evidence.
- Envelope size is bounded; oversize external messages are rejected before JSON expansion reaches persistence.
- Diagnostics never contain raw secret values.

## External Collector SDK protocol

V0.4 supports custom collectors as explicitly launched child processes using newline-delimited JSON over stdin/stdout.

The host launches only a user-selected executable/command. It does not auto-discover or auto-execute binaries from arbitrary directories.

Protocol:

1. Host launches collector with a minimal environment.
2. Host sends one `CollectorStartRequest` line on stdin.
3. Collector writes one manifest handshake line.
4. Host validates SDK version, collector ID, manifest, and requested capabilities.
5. Collector emits envelope lines on stdout.
6. Human-readable logs belong on stderr and are not treated as evidence.
7. Host sends a stop request on stdin or terminates the owned child after a bounded graceful-stop timeout.

Security constraints:

- secrets are not injected into the collector environment;
- inherited environment is minimized and sensitive variable names are removed unless explicitly required by a future approved design;
- external collector stdout is untrusted input;
- all events still pass core redaction before SQLite;
- external collectors cannot request arbitrary filesystem reads through HarnessScope APIs;
- file/path scope is supplied explicitly by the user and host.

## macOS native collector

### Scope

First-party macOS collector observes a process launched by HarnessScope and attributable descendants, plus metadata changes beneath user-selected directories.

### Process observation

Use supported macOS process APIs/system facilities available without injection. Record only fields the current user can lawfully access:

- PID and parent PID;
- process start/exit observation;
- executable path/identity when available;
- command line when available through supported interfaces;
- start/exit timestamp;
- exit code only for processes owned by the launcher when available.

If a field is unavailable due to OS privacy/permission restrictions, record it as unavailable rather than attempting bypass.

### File observation

Use supported filesystem notification facilities for explicitly selected directories. V0.4 captures metadata only:

- path;
- operation category;
- timestamp;
- size where safely available;
- optional hash only when the file is readable and hashing is explicitly enabled by collector config.

File contents are not captured by the V0.4 native collector.

Events can be coalesced by the OS; the collector must preserve that uncertainty in diagnostics rather than inventing a one-to-one write history.

## Linux native collector

### Scope

First-party Linux collector observes a process launched by HarnessScope and attributable descendants, plus metadata changes beneath explicitly selected directories.

### Process observation

Use supported `/proc` and process APIs available to the current user without ptrace or memory inspection. Record:

- PID/PPID;
- lifecycle;
- executable path when permitted;
- command line when permitted;
- start/exit timestamp;
- exit code for launcher-owned children when available.

If `/proc` visibility is restricted by container, namespace, hidepid, or policy, emit a structured capability/visibility diagnostic and continue with the observable subset.

### File observation

Use supported filesystem notifications, with inotify as the normal Linux implementation where available. Observe only explicit selected directories.

The host must handle watch exhaustion or recursive-watch limits as bounded diagnostics, not by silently widening privileges or polling the whole filesystem.

## Collector registry and host

The registry provides one authoritative list of available collectors to CLI and desktop front ends.

It is responsible for:

- registering first-party manifests;
- registering user-configured external collector commands;
- platform filtering;
- config schema validation;
- capability intersection with host policy;
- instance lifecycle;
- sequence validation;
- bounded buffering/backpressure;
- conversion to core `TraceEventInput` persistence calls;
- structured diagnostics/status.

### Backpressure

Collectors must not cause unbounded memory growth.

V0.4 uses a bounded per-instance queue. When the queue cannot accept more data within a bounded interval:

- the collector instance transitions to failed/stopped according to collector type;
- a diagnostic records evidence loss risk;
- the host never pretends the trace is complete.

Exact queue sizes/timeouts are implementation constants covered by tests and documented in code; they are not user-facing compatibility promises.

## CLI integration

Add an additive collector command family while retaining existing commands.

Conceptual interface:

```text
harnesscope collector list
harnesscope collector describe <collector-id>
harnesscope collector run <collector-id> --session <id> [collector options]
harnesscope collector external --command <exe> --session <id> [scope options]
```

For process collectors, `collector run` may accept `-- <target> [args...]` when the collector requires an owned launch.

The implementation plan may reuse existing `launch` and `watch-files` commands internally. V0.4 must not create two incompatible persistence paths.

## Desktop integration

Tauri remains the preferred desktop runtime.

Add a Collector panel/action family that can:

- list available collectors;
- display capability/authorization information;
- configure selected paths/target launch;
- start/stop one collector instance;
- show running/failed/stopped status and diagnostics.

The renderer receives only versioned collector actions through the existing bridge pattern. It does not receive raw process-spawn, filesystem, or native watcher APIs.

Electron fallback exposes the same action names where feasible, backed by the shared host, so renderer behavior does not fork by desktop runtime.

## Data flow and persistence

For every collector event:

```text
collector raw observation
  -> CollectorEnvelope validation
  -> canonical TraceEventInput
  -> existing core redaction
  -> append_event / append_events
  -> SQLite
  -> existing inference/export/UI
```

No collector-specific SQLite table is required for event payloads.

Collector instance metadata may be persisted as ordinary trace diagnostics/events or in an additive metadata structure if implementation requires restart history. Any schema change must be backward-compatible with V0.3 workspaces and documented in the implementation plan.

## Error model

Stable collector error categories:

- `COLLECTOR_NOT_FOUND`
- `COLLECTOR_UNSUPPORTED_PLATFORM`
- `COLLECTOR_INVALID_CONFIG`
- `COLLECTOR_CAPABILITY_DENIED`
- `COLLECTOR_ALREADY_RUNNING`
- `COLLECTOR_PROTOCOL_ERROR`
- `COLLECTOR_SEQUENCE_ERROR`
- `COLLECTOR_BACKPRESSURE`
- `COLLECTOR_START_FAILED`
- `COLLECTOR_RUNTIME_FAILED`
- `COLLECTOR_STOP_TIMEOUT`

Errors returned to UI/CLI are structured and redacted. Platform-native error text may be included only after removing sensitive path/value data according to existing redaction policy.

A collector failure never corrupts an existing workspace. Already committed evidence remains valid; the session receives a diagnostic that the observation may be incomplete.

## Authorization and privacy boundary

Before start, the user must be able to see:

- collector name;
- requested capabilities;
- target command when applicable;
- selected filesystem paths;
- whether hashing is enabled.

V0.4 never silently expands a selected path to parent/system directories.

Credential directories and common secret stores remain excluded by default. A future feature may allow explicit opt-in metadata observation for excluded paths, but V0.4 does not add that exception.

## Testing strategy

### SDK contract tests

Prove:

- manifest parsing and version rejection;
- capability validation;
- lifecycle transitions;
- duplicate/out-of-order sequence rejection;
- envelope size bounds;
- stdout/stderr separation for external collectors;
- malformed JSON fails one collector instance without corrupting the workspace;
- graceful and forced stop behavior;
- bounded queue/backpressure behavior.

### Redaction boundary tests

Use sentinel secrets in external collector messages and platform collector synthetic fixtures. Assert the sentinel never appears in persisted SQLite bytes, exports, diagnostics, or UI/API responses.

### macOS tests

On native macOS CI:

- launch a repository-owned synthetic child process;
- observe start/exit and attributable descendant where deterministic;
- observe file create/write/rename/remove within a temporary selected directory;
- verify no event is emitted for a sibling directory outside scope;
- verify native collector package compiles in the universal Tauri build.

Tests must tolerate OS-supported metadata fields being unavailable while requiring correct unavailable-state semantics.

### Linux tests

On Ubuntu CI:

- launch a synthetic process tree;
- validate PID/PPID lifecycle evidence;
- observe file metadata changes within a temporary selected directory;
- verify outside-scope changes are absent;
- test restricted/unavailable metadata behavior with injectable test adapters rather than changing host security policy.

### Cross-runtime regression

Existing V0.3 suite remains required:

- Node tests on Ubuntu/Windows/macOS;
- Rust format/clippy/tests;
- Node/Rust semantic parity;
- v0.2/v0.3 workspace compatibility;
- Tauri Windows and macOS native package validation;
- Electron fallback contract tests.

## CI design

Extend existing fail-closed CI rather than create a parallel untrusted release path.

Required V0.4 gates before merge/release:

1. Node regression — Ubuntu, Windows, macOS.
2. Rust core/SDK — Ubuntu, Windows, macOS.
3. Collector SDK protocol tests — Ubuntu, Windows, macOS where portable.
4. Linux native collector integration — Ubuntu.
5. macOS native collector integration — macOS.
6. Node/Rust semantic parity.
7. Tauri Windows package gate.
8. Tauri macOS universal package gate.
9. Release-contract exact-head verification.

Release workflow triggers only from a successful `main` CI run whose SHA exactly matches the source used for `v0.4.0`.

## Release artifacts

V0.4 retains the current desktop artifact shape with version replacement:

```text
Windows
HarnessScope-0.4.0-windows-x64-Setup.exe
HarnessScope-0.4.0-windows-x64.msi
HarnessScope-0.4.0-windows-x64-portable.zip

macOS
HarnessScope-0.4.0-macos-universal.dmg
HarnessScope-0.4.0-macos-universal.app.zip

Source / verification
HarnessScope-0.4.0-source.zip
SHA256SUMS.txt
```

Linux native collection ships in source/CLI runtime in V0.4; V0.4 does not add a Linux desktop binary release artifact. A packaged Linux desktop distribution is a separate future design because package formats, WebKit/runtime dependencies, signing, and support expectations require explicit scope.

## Documentation

Update README and docs to include:

- collector architecture and capability model;
- `collector list/describe/run` examples;
- macOS permission/visibility limitations;
- Linux `/proc`/inotify visibility limitations;
- external collector SDK protocol example using a repository-owned synthetic collector;
- explicit statement that collectors do not bypass OS security controls;
- release checksum verification.

## Migration and rollout

V0.4 is additive.

- Opening an existing V0.3 workspace does not require a destructive migration.
- Existing imports, launch observation, inference, compare, and export continue to work.
- Existing launch/watch implementation may be routed through first-party collectors only after parity tests prove equivalent observable behavior.
- If migration to the new collector host changes an existing command's behavior, the implementation must preserve the V0.3 contract or document a separately approved correction before merge.

## Acceptance criteria

V0.4 is complete only when all of the following are true:

1. `package.json` and native app metadata report exactly `0.4.0`.
2. Collector SDK version 1 is documented and contract-tested.
3. CLI can list/describe/start/stop first-party collectors.
4. An explicitly launched external synthetic collector can stream valid SDK envelopes into a session.
5. macOS native collector observes an owned synthetic process tree and selected-directory file metadata on native macOS CI.
6. Linux native collector observes an owned synthetic process tree and selected-directory file metadata on native Linux CI.
7. Out-of-scope filesystem activity is not persisted by the native collectors.
8. Sentinel secrets from collector input are absent from SQLite bytes and exports.
9. Existing V0.3 Node/Rust/parity/workspace/Tauri/Electron regression gates remain green.
10. Exact-head PR CI is green before merge.
11. Fresh `main` CI is green after merge.
12. `v0.4.0` release is created only from that exact successful `main` SHA.
13. Release contains exactly the expected seven V0.4 assets and valid SHA-256 checksums.

## Deferred after V0.4

- Windows ETW high-volume collector;
- packaged Linux Tauri desktop artifacts;
- signed/notarized desktop releases;
- richer network metadata collectors;
- collector marketplace/discovery/automatic installation;
- in-process native plugin ABI;
- clean-room harness generator/code generation;
- any invasive instrumentation or security-control bypass.
