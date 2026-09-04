# HarnessScope v0.3 — Tauri + Incremental Rust Core Migration

## Status

Approved architectural direction: replace Electron as the preferred desktop runtime with Tauri while migrating the HarnessScope core from Node.js to Rust incrementally. Electron v0.2 remains a development fallback until Rust/Tauri parity is demonstrated. This document is the implementation design for v0.3.0 and is pending final human review before implementation planning.

## Goals

HarnessScope v0.3 must deliver a Tauri desktop application for Windows and macOS that preserves the observable behavior, workspace compatibility, and clean-room evidence model established in v0.1/v0.2 while moving privileged application logic into Rust.

Primary outcomes:

- Tauri becomes the preferred desktop runtime.
- A new Rust core owns the major privileged and deterministic subsystems.
- Existing renderer action semantics remain stable so the UI is not rewritten for the migration.
- Existing v0.2 SQLite workspaces remain readable without destructive conversion.
- Node CLI and Electron desktop remain available during v0.3 as compatibility/fallback paths.
- Node and Rust implementations are continuously compared using canonical parity fixtures.
- Windows and macOS Tauri packages are built unsigned and released only after exact-head cross-platform CI is green.

## Non-goals

v0.3 does not:

- require Windows code signing;
- require Apple Developer ID signing or notarization;
- remove Electron before Tauri feature parity is demonstrated;
- rewrite the renderer framework solely for the migration;
- introduce cloud sync, remote accounts, billing, or hosted telemetry;
- add TLS pinning bypass, credential extraction, memory scraping, protected-source dumping, or vendor security-control bypasses;
- change HarnessScope from authorized clean-room observation into proprietary-code extraction;
- create a generalized plugin marketplace or broad SDK.

## Architectural strategy

The migration is incremental rather than an all-at-once Rust rewrite.

```text
HarnessScope UI
      │
      ▼
stable desktop action contract
      │
 ┌────┴──────────────┐
 │                   │
Tauri v0.3        Electron v0.2 fallback
 │                   │
Rust services       Node services
 │                   │
 └────────┬──────────┘
          ▼
 compatible HarnessScope workspace.sqlite
```

Tauri and Electron are alternate adapters over the same behavioral contract. The renderer must not know which backend language implements an action.

## Repository layout

```text
apps/
├─ desktop/                 existing Electron fallback
└─ tauri/
   ├─ src-tauri/
   │  ├─ Cargo.toml
   │  ├─ tauri.conf.json
   │  ├─ capabilities/
   │  └─ src/
   │     ├─ main.rs
   │     ├─ commands.rs
   │     ├─ state.rs
   │     └─ errors.rs
   └─ README.md

crates/
├─ harnesscope-core/
│  ├─ Cargo.toml
│  └─ src/
│     ├─ lib.rs
│     ├─ model.rs
│     ├─ redact.rs
│     ├─ store.rs
│     ├─ infer.rs
│     ├─ compare.rs
│     ├─ export.rs
│     ├─ import/
│     └─ observe/
└─ harnesscope-parity/
   ├─ Cargo.toml
   └─ src/

ui/                         existing renderer assets
src/                        existing Node core/CLI implementation
fixtures/                   shared canonical evidence fixtures
test/                       Node compatibility tests
.github/workflows/
├─ ci.yml
└─ release-v0.3.0.yml
```

The Rust core must not depend on Tauri. Tauri-specific imports stay under `apps/tauri/src-tauri`.

## Stable desktop action contract

The v0.2 bridge is treated as the migration boundary. v0.3 preserves these operation families and their semantics:

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

Tauri commands may use Rust naming internally, but the renderer adapter must continue to expose the same JavaScript-facing method structure and normalized result envelopes.

The contract is versioned. v0.3 remains compatible with the v0.2 contract version unless an incompatible change is unavoidable. Any incompatible change requires a new explicit bridge version and compatibility adapter rather than silent breakage.

## Rust core migration order

Subsystems move in this sequence so every step has a measurable parity boundary:

1. canonical data models and serialization;
2. redaction;
3. SQLite workspace/store;
4. timeline/session queries;
5. deterministic inference;
6. session comparison;
7. HAR / Procmon / JSONL importers;
8. spec exporter;
9. owned-process observation and metadata file observation;
10. desktop application services that compose the migrated modules.

A subsystem is not considered migrated merely because Rust code exists. It becomes authoritative for Tauri only after its parity tests pass against the Node behavior on shared fixtures.

## Canonical parity model

Parity testing is a first-class release gate.

```text
shared fixture
   ├─ Node implementation ──► canonical result A
   └─ Rust implementation ──► canonical result B

normalize(A) == normalize(B)
```

Normalization may remove only intentionally nondeterministic fields such as temporary paths, process IDs, timestamps generated at runtime, or platform-specific path separators. It must not hide semantic differences in findings, redaction, schema fields, event order, export content, or error categories.

Required parity fixture families:

- secret/redaction cases;
- SQLite session/event persistence;
- HAR normalization;
- Procmon normalization;
- JSONL field-map normalization;
- skill-loading inference;
- permission-gate inference;
- tool-schema inference;
- execution-loop inference;
- context marker inference;
- persistence/restart inference;
- compare output;
- deterministic spec/tool-schema export.

When Node and Rust disagree, the existing released v0.2 behavior is the default compatibility reference unless a deliberate behavior correction is documented with its own migration note and tests.

## Data model and SQLite compatibility

v0.3 preserves the v0.2 workspace format wherever possible.

The Rust store must open a v0.2-created database and correctly read:

- sessions;
- trace events;
- findings;
- finding evidence;
- existing identifiers and timestamps.

No destructive migration is allowed during ordinary open.

If schema evolution is required, the following rules apply:

- add an explicit schema version;
- migrations run transactionally;
- migrations are forward-only and idempotent;
- a backup is not silently deleted or overwritten;
- migration failure leaves the original database usable;
- fixtures include at least one real v0.2 schema database generated by the released Node implementation.

Concurrent Node/Electron/Tauri writers to the same database are not supported in v0.3 unless an explicit workspace-lock subsystem is completed. The application must detect a known active HarnessScope lock and return an actionable error rather than intentionally creating concurrent writers.

## Redaction boundary

The security rule remains unchanged: sensitive values must be redacted before persistence.

The Rust redactor must cover at least the v0.2 categories:

- authorization headers;
- cookies;
- API key/token/secret/password fields;
- private-key/client-secret fields;
- common bearer tokens;
- common provider token formats already covered by the Node implementation;
- sensitive URL query parameters.

Parity tests must include binary database inspection or equivalent evidence proving sentinel secrets are absent from persisted SQLite bytes.

## Tauri application shell

The Tauri shell owns desktop-only privileges and delegates domain work to `harnesscope-core`.

Responsibilities:

- application lifecycle;
- managed workspace path;
- Tauri command registration;
- native file/directory dialogs;
- external-link handling;
- per-window application state;
- invoking Rust services;
- translating Rust errors into stable renderer-safe envelopes.

The renderer receives no unrestricted shell, process, filesystem, SQLite, or Tauri internals.

## Tauri security model

v0.3 uses an explicit least-privilege Tauri capability configuration.

Rules:

- register only documented commands;
- do not expose generic shell execution to the renderer;
- do not expose arbitrary filesystem read/write APIs to the renderer;
- file access originates from user-selected native dialogs or backend-owned workspace paths;
- external navigation permits only validated `https:` URLs opened by the OS browser;
- deny unexpected in-webview navigation;
- no remote script dependency in the packaged UI;
- keep an explicit Content Security Policy;
- do not serialize raw privileged Rust errors or stack/backtrace details to the renderer;
- do not disable platform security controls to make unsigned builds easier to launch.

## Application services

Rust application services provide operations equivalent to the existing Electron service layer:

- create/list sessions;
- load timeline and findings;
- run inference;
- compare sessions;
- import authorized evidence;
- launch an explicitly requested process;
- export clean-room specifications;
- return workspace/application metadata.

Service inputs are bounded and validated before reaching domain logic. Session IDs, paths, command argument counts, mapping sizes, and imported file sizes use documented upper bounds to prevent accidental memory or IPC abuse.

## Process observation

v0.3 improves owned-process observation without turning HarnessScope into an unrestricted system monitor.

Required behavior:

- launch only a command explicitly submitted by the user;
- record owned process start/exit metadata;
- preserve the v0.2 rule that arbitrary stdout/stderr is not persisted by default;
- capture structured HarnessScope-owned fixture events for deterministic testing;
- keep metadata-only file observation for explicitly selected directories;
- avoid broad unrelated-process enumeration or termination.

A richer descendant-process tree is allowed when it can be implemented with normal OS APIs and remains scoped to the launched process tree. It is not a release blocker if platform parity cannot be achieved safely in v0.3.

## Renderer strategy

The current UI remains the renderer. A thin runtime adapter selects the available desktop backend while preserving the same view-model semantics.

```text
renderer feature code
        │
        ▼
data/runtime adapter
   ├─ Tauri bridge
   ├─ Electron bridge
   └─ browser development API
```

No feature should contain Tauri-specific invocation details outside the adapter.

Desktop actions retained from v0.2:

- New Session;
- Import;
- Launch;
- Infer;
- Compare;
- Export;
- Trace/Spec views and inspectors.

v0.3 may improve status indicators and migration/error messages, but a visual redesign is not part of the migration scope.

## Electron fallback policy

Electron remains checked in and buildable during v0.3 development.

Rules:

- no new domain logic may be added only to Electron if it belongs in shared core/application services;
- compatibility bugs discovered by parity tests may be fixed in the Node implementation when necessary;
- Electron is not removed in v0.3.0 unless every mandatory v0.3 parity and packaged-app gate has passed and removal is separately approved;
- release notes identify Tauri as the preferred runtime and Electron as a development fallback if Electron artifacts are not published.

The default v0.3 release does not need to publish Electron installers once Tauri packages pass all required release gates.

## CLI compatibility

The existing Node.js CLI remains supported in v0.3.0.

The Rust migration does not require replacing `bin/harnesscope.mjs` in this release. Keeping the Node CLI provides a compatibility oracle and avoids mixing a CLI rewrite into the desktop migration.

A future release may introduce a Rust CLI after the Rust core has been proven through v0.3.

## Packaging

v0.3 packages the preferred Tauri runtime.

### Windows

Required outputs are unsigned Windows packages produced by Tauri's supported bundler targets. The exact extension may be `.msi`, installer `.exe`, or both depending on the pinned Tauri/bundler configuration selected during implementation. At least one normal installer is mandatory, plus a documented portable/unpacked distribution if practical.

Artifact names must include `HarnessScope-0.3.0` and architecture.

### macOS

Required outputs:

- unsigned universal `.app` archive and/or universal `.dmg` when the pinned Tauri toolchain supports reliable universal bundling;
- if universal bundling is unreliable, explicit `arm64` and `x64` artifacts are required instead of a mislabeled universal build.

The workflow must not automatically remove quarantine attributes or disable Gatekeeper.

### Linux

Linux remains mandatory for Rust/Node core tests. A Tauri Linux package is optional for v0.3 and does not block Windows/macOS release unless promoted before implementation completion.

## Version and toolchain policy

Release version is `0.3.0` and tag is `v0.3.0`.

The implementation plan must pin:

- Rust toolchain version/channel used by CI;
- Tauri major/minor dependencies;
- SQLite crate/version;
- serialization and error-handling dependencies;
- any macOS universal-bundle helper if necessary.

Versions must be chosen from published stable releases at implementation time and committed in lockfiles. CI uses lockfiles and fails on unexpected dependency drift.

## CI design

Every PR affecting v0.3 runs these mandatory gates.

### Node compatibility

- Ubuntu: Node 22, existing `npm test`;
- Windows: Node 22, existing `npm test`;
- macOS: Node 22, existing `npm test`.

### Rust core

- formatting check;
- clippy with warnings treated as failures for HarnessScope-owned crates;
- Rust unit/integration tests on Ubuntu, Windows, and macOS where platform-specific code exists;
- parity harness against shared Node fixtures.

### Tauri desktop

- Windows Tauri compile/package gate;
- macOS Tauri compile/package gate;
- packaged main/backend startup smoke where practical without interactive GUI automation;
- command allowlist/static security checks;
- expected artifacts are present and non-empty.

Mandatory merge gates must be associated with the exact PR head SHA. No force/bypass merge is part of the v0.3 workflow.

## Release workflow

`release-v0.3.0.yml` is fail-closed.

```text
PR exact-head green
      ↓
merge main
      ↓
main exact-head Node + Rust + parity + Tauri CI green
      ↓
rebuild Windows package on native runner
      ↓
rebuild macOS package on native runner
      ↓
verify exact SHA + version + artifact set
      ↓
write SHA256SUMS.txt
      ↓
create tag v0.3.0
      ↓
publish GitHub Release
```

The release workflow must be idempotent. If `v0.3.0` exists, it verifies that the tag points to the expected commit and that the expected assets exist. A conflicting tag SHA fails closed.

No tag is created before all required release package jobs succeed.

## Error model

Rust/Tauri operations return the same renderer-safe envelope style as v0.2:

```json
{
  "ok": false,
  "code": "WORKSPACE_LOCKED",
  "message": "This HarnessScope workspace is already in use."
}
```

Error codes are stable API values. Internal Rust errors retain diagnostic context in development logs but renderer messages do not expose filesystem internals, SQL statements with sensitive values, raw stack traces, or secret-bearing payloads.

## Testing strategy

Tests are organized around behavioral contracts rather than framework internals.

Required test categories:

- Rust redaction unit tests and persisted-secret absence tests;
- v0.2 SQLite compatibility fixture tests;
- schema migration tests if schema versioning is introduced;
- Node/Rust parity tests for all deterministic core behaviors;
- importer golden tests;
- exporter golden tests;
- Tauri command input-validation tests;
- runtime adapter tests proving renderer code can target Tauri/Electron/browser without feature-specific branching;
- workspace lock/lifecycle tests if locking is implemented;
- Windows and macOS package validation;
- static release workflow contract checks;
- exact-head release verification.

No test requires Claude credentials, vendor-private APIs, paid signing identities, or network interception.

## Migration completion criteria

A subsystem is considered migrated only when:

1. its Rust implementation exists behind a clear crate/module API;
2. unit/integration tests pass;
3. Node/Rust canonical parity passes on shared fixtures;
4. Tauri uses the Rust implementation rather than invoking Node for that subsystem;
5. renderer-visible behavior remains compatible or a deliberate compatibility change is documented.

## v0.3.0 success criteria

v0.3.0 is complete only when all of the following are true:

1. The v0.2 Node CLI test suite remains green on Ubuntu, Windows, and macOS.
2. The Rust core implements redaction, workspace/store, timeline/session queries, inference, compare, import, export, and owned-process observation required by the Tauri workflow.
3. Shared canonical parity tests are green for deterministic migrated behaviors.
4. A v0.2-created workspace opens successfully in the Rust core without destructive conversion.
5. The Tauri desktop can create/select sessions, view traces/findings, import evidence, launch an explicit target, run inference/compare, and export specs.
6. The renderer has no unrestricted shell/filesystem/Tauri privilege surface.
7. Electron remains functional as a development fallback unless separately approved for removal.
8. Windows Tauri packaging succeeds on GitHub-hosted Windows CI.
9. macOS Tauri packaging succeeds for Apple Silicon and Intel, preferably as universal artifacts.
10. Exact-head PR CI and post-merge main CI are green across all mandatory Node, Rust, parity, and Tauri gates.
11. Only then is `v0.3.0` tagged and published with SHA256 checksums.

## Deferred candidates for v0.4+

Not part of v0.3 implementation:

- full Rust CLI replacement;
- removal of Electron fallback;
- signed/notarized Windows/macOS builds;
- richer process-tree telemetry beyond safely owned descendants;
- workspace switching with multi-workspace management UI;
- stable importer/plugin SDK;
- session replay engine;
- richer visual diff/replay UX;
- optional Linux desktop release;
- cloud synchronization or collaboration.
