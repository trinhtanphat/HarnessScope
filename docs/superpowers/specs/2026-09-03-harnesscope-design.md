# HarnessScope — Clean-Room Agent Harness Inspector Design

## Status
Approved by user; implementation started as standalone HarnessScope project.

## Goal
Build a new, standalone Windows-first open-source tool that helps an authorized user observe and understand the behavior of a coding-agent client such as Claude Code CLI/Desktop, then export a clean-room behavioral specification that can be used to build an independent harness with similar workflow characteristics.

HarnessScope is not part of QS3D and has no QS3D dependency.

## Product shape
HarnessScope ships as two front ends over one shared core:

1. `harnesscope` CLI for launching/importing observations, inspecting sessions, diffing runs, and exporting specs.
2. HarnessScope Desktop, a Tauri + React application for the execution-trace UI inspired by the supplied screenshots.

Both front ends use the same SQLite session database and Rust core crates.

## Safety and clean-room boundary
HarnessScope may inspect applications, files, logs, sessions, and traffic artifacts that the user owns or is authorized to inspect.

V1 must not:
- bypass authentication or access controls;
- defeat TLS certificate pinning or decrypt traffic by secretly installing interception trust roots;
- extract passwords, API keys, bearer tokens, cookies, signing keys, or other secrets;
- dump proprietary source code from protected binaries;
- ship code whose purpose is to disable vendor security controls.

Network analysis in V1 consumes user-exported HAR/JSONL/proxy logs or plaintext traffic from an explicitly configured development endpoint. Dynamic instrumentation data may be imported from external tools, but HarnessScope does not ship a built-in security-bypass injector.

The clean-room output records observed interfaces, state transitions, schemas, timing, and behaviors, not copied implementation code.

## Primary user workflow

```text
Authorized target app
    │
    ├── Process/file observation
    ├── User-supplied HAR / JSONL / Procmon CSV
    ├── Session/history artifacts selected by user
    └── Optional external instrumentation export
            │
            ▼
       Evidence Normalizer
            │
            ▼
        Trace Timeline
            │
            ├── process events
            ├── file/session events
            ├── tool calls/results
            ├── permission decisions
            ├── model/provider metadata
            ├── context/compaction signals
            └── skill/instruction reads
            │
            ▼
      Harness Inference Engine
            │
            ▼
 clean-room behavioral spec + JSON schema
```

## Success criteria
A user can run or import an agent session and answer, from evidence:

- Which process tree and child tools were involved?
- Which files/config/session stores were read or written?
- Which tool calls were made and in what order?
- Which permission boundaries were observed?
- Which context-management events occurred, including compaction/resume markers when visible?
- Which skill/instruction/reference files were read before a task phase?
- Which state survived app restart?
- Which observed behaviors differ between CLI and Desktop sessions?
- What clean-room state machine and tool schema can reproduce the visible behavior?

## Architecture

### Workspace
Rust Cargo workspace + pnpm workspace.

```text
harnesscope/
├─ Cargo.toml
├─ pnpm-workspace.yaml
├─ crates/
│  ├─ domain/                 # event/session/spec domain model
│  ├─ store/                  # SQLite persistence
│  ├─ observe-process/        # process-tree observation
│  ├─ observe-files/          # filesystem observation
│  ├─ import-har/             # HAR and generic HTTP transcript import
│  ├─ import-procmon/         # Procmon CSV import
│  ├─ import-jsonl/           # generic structured trace import
│  ├─ infer/                  # behavioral inference heuristics
│  └─ export-spec/            # Markdown + machine-readable spec
├─ apps/
│  ├─ cli/                    # Rust clap CLI
│  └─ desktop/                # Tauri shell
├─ packages/
│  └─ desktop-ui/             # React UI
├─ fixtures/                  # synthetic, non-vendor test evidence
└─ docs/
```

### Shared domain model
All observations normalize to append-only events:

```rust
pub struct TraceEvent {
    pub id: EventId,
    pub session_id: SessionId,
    pub timestamp_utc: DateTime<Utc>,
    pub source: EvidenceSource,
    pub kind: EventKind,
    pub correlation_id: Option<String>,
    pub data: serde_json::Value,
    pub redaction: RedactionState,
}
```

Important `EventKind` values:
- `ProcessStarted`, `ProcessExited`
- `FileRead`, `FileWritten`, `FileRenamed`
- `HttpRequest`, `HttpResponse`, `StreamEvent`
- `ToolCall`, `ToolResult`
- `PermissionPrompt`, `PermissionDecision`
- `InstructionRead`, `SkillRead`
- `ContextMarker`, `CompactionMarker`, `ResumeMarker`
- `UserPrompt`, `AssistantMessage`
- `Unknown`

Raw evidence is immutable. Derived/inferred events are stored separately and carry a confidence score and provenance back to raw evidence.

## Evidence collectors

### Process observer
Windows-first implementation observes a launched target and descendants. It records executable identity, PID/parent PID, start/exit time, command-line when accessible, and exit code when owned by the launcher.

V1 uses supported OS APIs/polling rather than invasive process memory scraping.

### File observer
The user selects explicit directories to watch. The collector records path, operation, timestamp, and size/hash metadata where safe. Content capture is opt-in and passes through secret redaction before persistence.

Default rules exclude known credential/token stores and common secret filenames.

### HAR importer
Imports HAR 1.2 and converts entries to HTTP/stream evidence. Sensitive headers, cookies, query secrets, and authorization data are redacted before the trace is stored.

### Procmon importer
Imports an exported Procmon CSV and correlates process/file/registry/network metadata by PID and timestamp. HarnessScope never needs Procmon kernel privileges itself for this path.

### JSONL importer
A generic adapter for external instrumentation or application logs. Users map keys to event kinds through a small YAML mapping file.

## Secret redaction
Redaction happens before database persistence.

Built-in rules redact at minimum:
- `Authorization` headers;
- cookies and set-cookie values;
- API keys/tokens matching common prefixes;
- environment variable names containing `TOKEN`, `SECRET`, `PASSWORD`, `COOKIE`, or `KEY` unless explicitly allowlisted;
- JSON properties with equivalent sensitive names.

The UI displays `[REDACTED]` and records that redaction occurred without retaining the original value.

## Harness inference engine
Inference is deterministic and evidence-driven. It never claims hidden behavior without evidence.

Initial inference rules:

1. **Tool schema inference**: cluster structurally similar request objects and identify candidate tool name, arguments, result, and correlation IDs.
2. **Skill loading**: classify ordered reads of instruction/reference Markdown or structured skill files that precede a plan/action phase.
3. **Permission gate**: detect a proposed action followed by an allow/deny/ask decision before execution.
4. **Execution loop**: group repeated `inspect -> mutate -> execute -> verify -> repair` patterns.
5. **Session persistence**: identify state artifacts written before exit and read after restart.
6. **Context management**: detect explicit visible markers such as compact/summarize/resume/context-window events; do not infer private token counts when absent.
7. **CLI vs Desktop diff**: compare two sessions by capability/event/state-machine surface and report observations unique to each.

Every inferred finding contains:

```rust
pub struct Finding {
    pub title: String,
    pub category: FindingCategory,
    pub confidence: f32,
    pub evidence_event_ids: Vec<EventId>,
    pub statement: String,
}
```

## Clean-room spec exporter
Exports:

- `harness-spec.md` — readable architecture/state-machine report;
- `harness-spec.json` — machine-readable capabilities, tools, states, transitions, persistence and permission observations;
- `tool-schemas/*.json` — observed/redacted candidate tool schemas;
- `session-diff.md` — when comparing CLI and Desktop runs.

Statements are prefixed with evidence status:
- `OBSERVED`
- `INFERRED_HIGH`
- `INFERRED_MEDIUM`
- `UNKNOWN`

The exporter must never label an inference as vendor source truth.

## CLI contract

```text
harnesscope session new --name <name>
harnesscope launch --session <id> -- <target> [args...]
harnesscope watch-files --session <id> --path <dir>
harnesscope import har --session <id> <file.har>
harnesscope import procmon --session <id> <file.csv>
harnesscope import jsonl --session <id> <file.jsonl> --map <mapping.yaml>
harnesscope timeline --session <id>
harnesscope infer --session <id>
harnesscope compare <session-a> <session-b>
harnesscope export --session <id> --out <dir>
```

`launch` observes only the process it starts and descendants that can be attributed to it.

## Desktop UX
The Desktop app follows the visual concept in the supplied screenshots without copying vendor assets.

### Main layout
- top tabs: `Trace` and `Spec`;
- left: sessions/workspaces;
- center: chronological execution trace;
- right drawer: inspector for selected event/finding;
- bottom command bar for imports, launch, infer, compare, export.

### Trace grouping
Compact groups render summaries such as:

```text
Read 10 files, ran 1 command, observed 2 tool calls
```

Expanding a group shows redacted evidence and provenance.

### Inspector views
- Process tree
- Files and session artifacts
- HTTP/stream timeline
- Tool call/result pairs
- Permission decisions
- Skills/instructions
- Context/resume markers
- Findings with confidence

## Persistence
SQLite database per workspace, using WAL mode.

Core tables:
- `sessions`
- `trace_events`
- `evidence_files`
- `findings`
- `finding_evidence`
- `artifacts`
- `redaction_log`

No unredacted secret column exists.

## Error handling
- malformed imports fail with line/entry-scoped diagnostics;
- one malformed evidence entry does not corrupt a previously committed session;
- inference can run with partial evidence and clearly reports unknowns;
- file-content permission failures become metadata-only observations;
- inaccessible process metadata is represented as unknown rather than bypassed;
- export is atomic to a temporary directory then renamed on success.

## Testing strategy

### Rust unit tests
- event normalization;
- secret redaction;
- correlation and clustering;
- inference rules;
- deterministic spec export;
- session diff.

### Import fixture tests
Synthetic HAR, Procmon CSV, and JSONL fixtures contain no Anthropic/Claude proprietary data.

### Integration tests
A repository-owned dummy agent fixture simulates:
- reading skills;
- prompting for permission;
- running a child command;
- writing session state;
- exiting and resuming.

HarnessScope must reconstruct that known state machine exactly before it is used on third-party software.

### Desktop tests
React component tests for trace grouping, redaction display, filters, and finding provenance. Tauri smoke test validates a workspace can be opened and exported.

## V1 acceptance
V1 is complete when:

1. CLI can create a session, launch the synthetic agent, observe its process tree, import evidence, infer the known behavior, and export deterministic Markdown/JSON.
2. Secret fixtures prove sensitive values are absent from the SQLite database and exports.
3. CLI vs Desktop-style synthetic sessions can be compared and produce a capability diff.
4. Desktop can open the same workspace database and render grouped trace + finding provenance.
5. CI passes on Windows and Linux for portable crates; Windows-only collector tests are gated appropriately.
6. README documents authorization/clean-room boundaries and a Claude Code/Desktop observation tutorial that uses only user-accessible artifacts and user-exported logs.

## Deferred after V1
- ETW high-volume collector;
- macOS/Linux native process collectors beyond portable fallback;
- plugin SDK for custom evidence collectors;
- automated harness reimplementation/code generation;
- built-in dynamic instrumentation/injection;
- any feature whose primary purpose is bypassing vendor security controls.

## License
Recommended: Apache-2.0 OR MIT dual license for HarnessScope-owned code. No vendor code/assets are included.
