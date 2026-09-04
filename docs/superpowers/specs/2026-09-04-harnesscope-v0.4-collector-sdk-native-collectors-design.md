# HarnessScope v0.4 — Collector SDK + Native macOS/Linux Collectors Design

## Status

Direction approved by user on 2026-09-04. This written specification is pending final user review before implementation planning.

## Goal

Ship HarnessScope `v0.4.0` with a stable, capability-bounded Collector SDK and first-party native process/file collectors for macOS and Linux, while preserving the released v0.3 clean-room, redaction, SQLite, Node/Rust parity, Tauri, CLI, Electron-fallback, and fail-closed release contracts.

V0.4 separates evidence acquisition from normalization/persistence. Collectors emit a versioned process protocol; runtime hosts validate that protocol and route canonical events through the existing redaction and persistence boundary.

## Why V0.4

V0.3 established the Rust core, Tauri desktop runtime, cross-runtime workspace lock, semantic parity, and native Windows/macOS release pipeline. The original V1 design deferred macOS/Linux native process collectors and a custom Collector SDK. V0.4 implements those two items only.

Windows ETW, Linux desktop packages, signing/notarization, and harness generation remain deferred.

## Version and compatibility contract

- Product version becomes exactly `0.4.0`.
- Release tag is exactly `v0.4.0`.
- V0.3 workspaces remain readable and writable without destructive migration.
- V0.4 introduces no required SQLite schema migration; collector lifecycle/status is represented as canonical trace events and diagnostics.
- Existing Node CLI commands remain supported.
- Existing Tauri and Electron action families remain compatible; collector actions are additive.
- Existing event kinds, finding semantics, redaction-before-persistence rule, workspace lock, and clean-room exporter remain compatibility references.
- Existing v0.3 releases remain immutable.
- V0.4 Windows/macOS packages remain intentionally unsigned unless a separate signing design is approved.

## Non-goals

V0.4 does not:

- add Windows ETW high-volume collection;
- inject code into another process;
- use ptrace for memory inspection;
- scrape process memory;
- bypass authentication, access control, TLS pinning, sandboxing, SIP, Gatekeeper, SELinux, AppArmor, or other security controls;
- silently elevate privileges;
- capture secrets or credential stores;
- decompile or extract protected vendor source;
- load arbitrary third-party dynamic libraries into HarnessScope;
- automatically discover or execute collector binaries from arbitrary directories;
- generate a replacement agent harness from findings.

## Chosen architecture

V0.4 uses an **out-of-process JSONL Collector Protocol** as the shared compatibility surface.

First-party macOS/Linux native collection is implemented as a Rust collector executable that speaks the same protocol as future custom collectors. Node CLI, Tauri, and Electron host the same protocol rather than sharing an in-process native plugin ABI.

This avoids a Node native-addon dependency, preserves process isolation, and prevents the renderer from receiving filesystem/process/native watcher APIs.

```text
Authorized target / selected paths
              |
              v
+----------------------------------+
| Native/custom collector process  |
| Collector Protocol v1 over JSONL |
+----------------------------------+
              |
              v
+----------------------------------+
| Runtime collector host           |
| Node host: CLI + Electron        |
| Rust host: Tauri                 |
+----------------------------------+
              |
              v
+----------------------------------+
| canonical TraceEventInput        |
| redaction -> SQLite -> inference |
+----------------------------------+
```

## Repository component boundaries

V0.4 adds these logical units:

### `crates/harnesscope-collector-sdk`

Framework-independent Rust protocol/domain crate. It owns:

- Collector Protocol v1 structures;
- manifest/capability validation;
- envelope size/sequence validation primitives;
- stable collector error codes;
- JSON serialization compatibility fixtures.

It does not spawn processes, watch files, open SQLite, or depend on Tauri.

### `crates/harnesscope-native-collector`

First-party collector executable with target-specific modules:

- macOS process/file observation when `target_os = "macos"`;
- Linux process/file observation when `target_os = "linux"`.

The binary speaks Collector Protocol v1 over stdin/stdout. Windows builds may compile a protocol/unsupported-platform shell for contract testing, but V0.4 exposes no new Windows native collector capability.

### `src/collectors/host.mjs`

Node protocol host used by the portable Node CLI and Electron fallback. It owns process lifecycle, JSONL framing, protocol validation, bounded buffering, and routing events to the existing Node store/redaction path.

It never trusts collector stdout and never persists raw collector lines directly.

### Tauri collector host

The Tauri Rust shell uses `harnesscope-collector-sdk` validation and explicit child-process lifecycle code to host the same Collector Protocol v1. It routes accepted events through the existing Rust core/store boundary.

The renderer sees only explicit versioned Tauri commands.

### Shared fixtures

Canonical Collector Protocol fixtures are consumed by both Node and Rust host tests so host semantics cannot drift silently.

## Collector Protocol v1

### Transport

- newline-delimited UTF-8 JSON on stdin/stdout;
- one JSON object per line;
- human-readable logs only on stderr;
- stdout is protocol-only;
- protocol version is string `"1"`.

### Startup handshake

Host launches a collector only after explicit user selection/configuration.

1. Host starts the child with a minimized environment.
2. Host writes one `start` request line.
3. Collector writes one `manifest` response line.
4. Host validates SDK version, collector ID, platform, requested capabilities, and explicit path/target scope.
5. Host writes one `start-confirmed` line containing the allowed capability intersection.
6. Collector may then emit event/diagnostic/heartbeat envelopes.

A collector that emits evidence before successful handshake is terminated with `COLLECTOR_PROTOCOL_ERROR`.

### Manifest

```json
{
  "type": "manifest",
  "sdkVersion": "1",
  "collector": {
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
}
```

Rules:

- first-party collector IDs are stable reverse-DNS-style strings;
- V0.4 accepts protocol version `1` only;
- unknown requested capabilities are never authorized;
- host policy is authoritative even if the manifest claims a capability;
- external collector manifests may contain unknown future metadata fields, but those fields grant no behavior or permission;
- first-party manifest fixtures are exact-contract tested.

### V0.4 capabilities

Implemented:

- `process.lifecycle` — observable process start/exit and parent-child relationships;
- `process.metadata` — executable identity, PID/PPID, command line when supported and accessible;
- `file.metadata` — explicitly scoped create/write/remove/rename metadata;
- `collector.diagnostics` — structured status/warning/error messages.

Reserved and unauthorized in V0.4:

- `network.metadata`;
- `registry.metadata`;
- `kernel.trace`;
- `content.capture`.

### Start request

A start request includes only explicit scope required by the selected collector:

```json
{
  "type": "start",
  "sdkVersion": "1",
  "instanceId": "...",
  "sessionId": "...",
  "paths": ["/explicit/user/selected/path"],
  "hashFiles": false,
  "target": {
    "command": "/path/to/authorized-target",
    "args": []
  }
}
```

No secret values are required by the first-party protocol.

### Evidence envelopes

```json
{
  "type": "event",
  "sdkVersion": "1",
  "collectorId": "harnesscope.linux.process-files",
  "instanceId": "...",
  "sequence": 42,
  "event": {
    "source": "collector",
    "kind": "ProcessStarted",
    "correlationId": "pid:1234",
    "data": {}
  }
}
```

Protocol output types after handshake:

- `event` — one canonical `TraceEventInput`;
- `diagnostic` — structured redaction-safe diagnostic;
- `heartbeat` — liveness only, not persisted as ordinary evidence unless host records a state transition;
- `completed` — clean terminal marker.

Rules:

- `sequence` starts at `1` and increments by exactly `1` per emitted post-handshake envelope;
- duplicate or skipped/out-of-order sequence numbers fail that collector instance with `COLLECTOR_SEQUENCE_ERROR`;
- every line has a hard byte bound before JSON parsing;
- protocol nesting/collection sizes are bounded by validation;
- malformed JSON fails only the collector instance, not the workspace;
- raw stdout is never persisted;
- all accepted events pass core redaction before SQLite.

### Stop lifecycle

Collector states are:

```text
registered -> starting -> running -> stopping -> stopped
                    \-> failed
```

Host sends an explicit stop request. The child receives a bounded graceful-stop interval. If it does not terminate, the host terminates the owned child and records `COLLECTOR_STOP_TIMEOUT`.

Stop after `stopped` or `failed` is idempotent.

## External Collector SDK

Custom collectors are explicitly launched executables that implement Collector Protocol v1.

V0.4 does not provide automatic discovery, download, installation, marketplace, or trust elevation.

Host security requirements:

- user selects/configures the executable explicitly;
- child environment is minimized;
- common secret environment variables are removed before launch;
- no HarnessScope credential/token is injected;
- collector stdout is treated as untrusted input;
- filesystem scope is explicit and host-visible;
- external collectors cannot call back into unrestricted HarnessScope filesystem/process APIs;
- event data is redacted again by core even if the collector claims it already redacted content.

A repository-owned synthetic collector is the reference implementation and protocol test target.

## Native sidecar packaging and availability

### macOS

The first-party native collector executable is built for the macOS universal target and bundled inside the Tauri `.app`/DMG package as an application-owned sidecar. The Tauri host launches only that bundled path for the first-party collector ID.

The source tree can also build/run the collector directly for CLI development.

### Linux

V0.4 does not introduce Linux desktop release artifacts. Linux native collection is supported when running from source with the first-party collector binary built from the pinned Rust workspace.

The portable Node CLI continues to work without Rust for all pre-V0.4 commands. New native `collector run` commands fail with a clear `COLLECTOR_NOT_INSTALLED`/availability diagnostic if the required first-party collector executable is not present.

### Electron fallback

Electron uses the Node collector host and the same bundled/source collector executable when available. Existing Electron functionality remains usable when no native collector sidecar is installed.

## macOS native collector

### Scope

Observe one process launched by HarnessScope, attributable descendants where supported, and metadata changes beneath explicit user-selected directories.

### Process observation

Use supported macOS APIs/system facilities without injection. Record only what the current user is allowed to read:

- PID/PPID;
- start/exit observation;
- executable identity/path when available;
- command line when available;
- start/exit timestamps;
- exit code only for launcher-owned processes when available.

Unavailable privacy-restricted fields are represented as unavailable/unknown. The collector never escalates privileges to fill them.

### File observation

Use supported macOS filesystem notification facilities for selected directories only.

Capture metadata only:

- path;
- operation category;
- timestamp;
- size when safely available;
- optional SHA-256 hash only when `hashFiles=true`, path is inside explicit scope, and the current user can read the file normally.

V0.4 does not capture file contents.

Because macOS notification facilities may coalesce events, the collector records a diagnostic when event granularity is uncertain rather than inventing a one-to-one write sequence.

## Linux native collector

### Scope

Observe one process launched by HarnessScope, attributable descendants, and metadata changes beneath explicit selected directories.

### Process observation

Use supported `/proc`/process APIs available to the current user. Do not use ptrace or memory inspection.

Record when available:

- PID/PPID;
- lifecycle;
- executable identity/path;
- command line;
- start/exit timestamps;
- exit code for launcher-owned processes.

If `/proc` visibility is restricted by container namespace, `hidepid`, or policy, emit a structured visibility diagnostic and continue with the observable subset.

### File observation

Use inotify where available for explicitly selected directories.

Recursive directory scope is implemented by watches beneath the selected root only. Newly created directories under the selected root may receive watches. Parent/sibling/system directories are never added implicitly.

Watch exhaustion or platform limits produce a bounded diagnostic and incomplete-evidence state; the collector does not silently broaden scope or request elevated privileges.

## Host registry and availability

Each runtime host exposes one authoritative collector registry containing:

- first-party manifests known to that product version;
- current platform availability;
- executable availability/path for first-party sidecars;
- explicitly configured external collectors;
- capability policy;
- instance status.

Registry operations:

- list;
- describe;
- validate configuration;
- start;
- status;
- stop.

Starting the same instance key twice returns `COLLECTOR_ALREADY_RUNNING`.

## Backpressure and evidence completeness

Each collector instance has a bounded queue between protocol reader and persistence.

If the queue cannot accept data within the configured bounded interval:

1. host stops/fails that collector instance;
2. host records `COLLECTOR_BACKPRESSURE`;
3. session receives an explicit incomplete-evidence diagnostic;
4. already committed evidence remains valid;
5. host never claims the observation is complete.

Queue sizes and timeouts are implementation constants, tested and documented in source, not long-term public compatibility values.

## CLI integration

Add an additive command family:

```text
harnesscope collector list
harnesscope collector describe <collector-id>
harnesscope collector run <collector-id> --session <id> [scope options] -- <target> [args...]
harnesscope collector external --command <exe> --session <id> [scope options]
```

`collector list` reports installed/available/unavailable status without treating an unavailable native sidecar as a product failure.

Existing `launch` and `watch-files` commands retain their V0.3 behavior in V0.4. They are not silently reimplemented through the new collector path in this release. Unification can happen later after explicit parity evidence.

## Desktop integration

Tauri remains preferred.

Add collector actions for:

- list/describe collectors;
- configure target and selected paths;
- display requested capabilities before start;
- start/stop one instance;
- show running/stopped/failed/incomplete status and diagnostics.

The renderer never receives raw spawn, filesystem, watcher, SQLite, or sidecar handles.

Electron fallback uses the same renderer action names backed by the Node collector host where the collector executable is available.

## Persistence and provenance

No collector-specific evidence table is added.

Accepted events flow through:

```text
protocol line
 -> protocol validation
 -> TraceEventInput
 -> existing redaction
 -> existing append_event/append_events
 -> SQLite
 -> existing inference/export/UI
```

Collector lifecycle is recorded using canonical diagnostic/status trace events with:

- collector ID/version;
- instance ID;
- requested and authorized capabilities;
- selected-scope summary;
- start/stop/failure state;
- evidence-completeness flag;
- protocol/runtime error code where applicable.

Raw external stderr is not persisted automatically. A bounded redacted diagnostic summary may be included on failure.

## Stable error categories

V0.4 defines:

- `COLLECTOR_NOT_FOUND`
- `COLLECTOR_NOT_INSTALLED`
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

Errors returned to CLI/UI are structured and redacted. Collector failure cannot roll back or corrupt evidence already committed to the workspace.

## Authorization and privacy boundary

Before start the user can see:

- collector ID/name/version;
- requested capabilities;
- target command when applicable;
- explicit filesystem roots;
- whether hashing is enabled;
- first-party vs external collector origin.

V0.4 never silently expands a selected root to its parent or unrelated system directories.

Common credential/token stores remain excluded by default from first-party file observation. V0.4 adds no override for those default exclusions.

## Testing strategy

### Protocol/SDK contract

Canonical fixtures prove in both Node and Rust:

- valid handshake;
- version rejection;
- capability intersection;
- unknown capability denial;
- malformed JSON rejection;
- line-size/nesting bounds;
- exact sequence semantics;
- stdout/stderr separation;
- clean completion;
- stop timeout;
- backpressure failure semantics.

### Synthetic external collector

A repository-owned executable/script implements Protocol v1 and can emit deterministic events, malformed messages, sequence gaps, stderr diagnostics, and sentinel secrets for tests.

### Redaction boundary

Sentinel secrets arriving from a collector must be absent from:

- SQLite database bytes after close;
- exported Markdown/JSON/tool-schema artifacts;
- host diagnostics;
- CLI/Tauri/Electron responses.

### macOS native integration

On native macOS CI:

- build the universal first-party sidecar;
- launch a repository-owned process with a deterministic child;
- observe lifecycle evidence where supported;
- create/write/rename/remove files inside a temporary selected root;
- verify sibling/outside-root activity is absent;
- validate coalesced/unavailable semantics;
- package the sidecar into the universal Tauri app and verify it exists in the built bundle.

### Linux native integration

On Ubuntu CI:

- build the first-party collector;
- launch a deterministic process tree;
- observe PID/PPID lifecycle evidence;
- create/write/rename/remove files inside selected scope;
- verify outside-root activity is absent;
- test restricted `/proc` and watch-limit behavior through injectable adapters/fixtures without altering runner security policy.

### V0.3 regression

All existing V0.3 gates remain required:

- Node tests Ubuntu/Windows/macOS;
- Rust format/clippy/tests;
- Node/Rust semantic parity;
- V0.2/V0.3 workspace compatibility;
- Tauri Windows/macOS package validation;
- Electron fallback contract tests.

## CI design

Required V0.4 merge/release gates:

1. Node regression — Ubuntu, Windows, macOS.
2. Rust core + Collector SDK — Ubuntu, Windows, macOS.
3. Protocol parity fixtures — Node and Rust.
4. Synthetic external collector integration — Ubuntu, Windows, macOS.
5. Linux native collector integration — Ubuntu.
6. macOS native collector integration — macOS.
7. Existing Node/Rust semantic parity.
8. Tauri Windows native package gate.
9. Tauri macOS universal package gate including bundled first-party sidecar.
10. Exact-head release-contract tests.

No PR is merged until exact-head required checks are green.

After merge, fresh `main` CI must be green before release. `release-v0.4.0` may create tag/release only when the triggering successful `main` SHA exactly matches the release source SHA.

## Release artifacts

V0.4 retains exactly seven top-level GitHub Release assets:

```text
HarnessScope-0.4.0-windows-x64-Setup.exe
HarnessScope-0.4.0-windows-x64.msi
HarnessScope-0.4.0-windows-x64-portable.zip
HarnessScope-0.4.0-macos-universal.dmg
HarnessScope-0.4.0-macos-universal.app.zip
HarnessScope-0.4.0-source.zip
SHA256SUMS.txt
```

The macOS first-party collector sidecar is contained inside the macOS application artifacts, not uploaded as an eighth top-level release asset.

Linux native collection is source-built in V0.4; no Linux desktop release asset is added.

## Documentation

README/docs must document:

- Collector Protocol v1;
- first-party versus external collector trust model;
- collector list/describe/run examples;
- macOS visibility/permission limitations;
- Linux `/proc`/inotify limitations;
- source-build instructions for Linux native collector;
- availability behavior when a sidecar is absent;
- synthetic custom collector example;
- explicit no-bypass/no-memory-scraping boundary;
- release checksum verification.

## Migration and rollout

V0.4 is additive:

- existing workspaces require no destructive migration;
- existing `launch`, `watch-files`, import, infer, compare, export flows keep V0.3 behavior;
- new collector flows use separate additive commands/actions;
- existing flows are not switched to collectors during V0.4;
- any future unification requires parity evidence and a separately reviewed change.

## Acceptance criteria

V0.4 is complete only when:

1. package and native app metadata report exactly `0.4.0`.
2. Collector Protocol v1 is documented and contract-tested in Node and Rust.
3. CLI lists/describes collectors and reports availability correctly.
4. CLI can explicitly launch an installed first-party collector and an explicitly selected external collector.
5. Tauri can start/stop the bundled macOS first-party sidecar through bounded commands.
6. Electron can host the same protocol when the sidecar/external collector is available.
7. macOS native CI proves owned process + selected-root file metadata observation and outside-root exclusion.
8. Linux native CI proves owned process + selected-root file metadata observation and outside-root exclusion.
9. protocol sequence, malformed-input, stop-timeout, and backpressure tests pass.
10. sentinel secrets from collector input are absent from persisted SQLite bytes and exports.
11. existing V0.3 Node/Rust/parity/workspace/Tauri/Electron regressions remain green.
12. exact-head PR CI is green before merge.
13. fresh `main` CI is green after merge.
14. `v0.4.0` tag/release points exactly to that successful `main` SHA.
15. release contains exactly the seven expected V0.4 assets with SHA-256 verification.

## Deferred after V0.4

- Windows ETW high-volume collector;
- packaged Linux Tauri desktop artifacts;
- signed/notarized releases;
- richer network metadata collectors;
- collector marketplace/discovery/automatic installation;
- in-process native plugin ABI;
- automatic clean-room harness generation/code generation;
- invasive instrumentation or security-control bypass features.
