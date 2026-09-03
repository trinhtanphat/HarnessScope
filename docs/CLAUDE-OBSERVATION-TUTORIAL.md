# Authorized Claude Code / Desktop Observation Tutorial

This guide shows how to use HarnessScope to study **visible behavior** of Claude Code CLI or a desktop coding-agent client without copying proprietary source or bypassing security controls.

## 1. Decide the behavior you want to measure

Use a small disposable repository and one repeatable prompt, for example:

```text
/pro-dev build a small interactive landing page, inspect the project first, then verify it
```

The exact slash command is not important. The important part is that CLI and Desktop receive the same task so their observable workflows can be compared.

## 2. Create two HarnessScope sessions

```powershell
node .\bin\harnesscope.mjs --db .\lab\workspace.sqlite session new --name claude-cli --mode cli
node .\bin\harnesscope.mjs --db .\lab\workspace.sqlite session new --name claude-desktop --mode desktop
```

Save the returned ids.

## 3. CLI observation

If you normally start Claude Code from a terminal, launch it through HarnessScope:

```powershell
node .\bin\harnesscope.mjs --db .\lab\workspace.sqlite launch --session <CLI_ID> -- claude
```

The built-in launcher records only the process it starts and structured HarnessScope fixture markers. For detailed child process/file activity on Windows, use Procmon as an external evidence source.

## 4. Desktop observation with Procmon

1. Start Microsoft Sysinternals Process Monitor yourself.
2. Apply filters narrowly to the desktop client process and its relevant descendants.
3. Reproduce the disposable test task.
4. Stop capture as soon as the task is complete.
5. Export the selected events as CSV.
6. Review the CSV before importing it. Remove rows that contain unrelated private paths or data you do not want in the lab database.
7. Import:

```powershell
node .\bin\harnesscope.mjs --db .\lab\workspace.sqlite import procmon --session <DESKTOP_ID> .\capture\desktop.csv --date 2026-09-04
```

Useful evidence can include:

- `Process Create` for shells/build tools;
- `ReadFile` for instruction/skill/config documents;
- `WriteFile` for session or workspace state;
- process exit/restart boundaries.

A file read does not prove why the app read the file. HarnessScope labels such conclusions as inference rather than vendor truth.

## 5. Optional network evidence

HarnessScope does not install proxy certificates or bypass TLS pinning.

If your authorized environment already produces an exportable HAR or plaintext development transcript, review the artifact and import it:

```powershell
node .\bin\harnesscope.mjs --db .\lab\workspace.sqlite import har --session <ID> .\capture\session.har
```

Before SQLite persistence, HarnessScope redacts authorization headers, cookies, common secret fields, secret query parameters and common token formats.

Do not attempt to defeat certificate pinning or authentication just to obtain a trace.

## 6. Optional application logs / external instrumentation export

If an authorized tool emits JSONL, map its fields:

```yaml
timestamp: timestamp
kind: event_type
correlationId: request_id
data: payload
source: authorized-export
```

Then:

```powershell
node .\bin\harnesscope.mjs --db .\lab\workspace.sqlite import jsonl --session <ID> .\capture\events.jsonl --map .\capture\map.yaml
```

HarnessScope can normalize known names such as `tool_call`, `tool_result`, `permission_prompt`, `permission_decision`, `skill_read`, `compaction_marker` and `resume_marker`.

## 7. Run inference

```powershell
node .\bin\harnesscope.mjs --db .\lab\workspace.sqlite infer --session <CLI_ID>
node .\bin\harnesscope.mjs --db .\lab\workspace.sqlite infer --session <DESKTOP_ID>
```

Look specifically for:

- skill/instruction reads before execution;
- permission prompt → decision pairs;
- candidate tool-call schemas;
- edit/run/verify loops;
- explicit compact/resume markers;
- state artifacts written before exit and read after restart.

If evidence for a claim does not exist, the correct result is `UNKNOWN` rather than a guess.

## 8. Compare CLI vs Desktop

```powershell
node .\bin\harnesscope.mjs --db .\lab\workspace.sqlite compare <CLI_ID> <DESKTOP_ID>
```

This is the cleanest way to investigate the kind of "Desktop harness bonus" described in the screenshots: observe capabilities or state transitions present in Desktop evidence but absent in a matched CLI run.

Examples of meaningful differences are:

- Desktop-only resume markers;
- Desktop-only workspace/session files;
- additional permission/UI state events;
- extra instruction/skill reads;
- different tool surfaces.

A difference is still an observation about the tested versions and task, not proof of the vendor's private implementation.

## 9. Export the behavioral spec

```powershell
node .\bin\harnesscope.mjs --db .\lab\workspace.sqlite export --session <DESKTOP_ID> --out .\lab\desktop-spec
```

Use `harness-spec.md`, `harness-spec.json` and `tool-schemas/*.json` as the clean-room input to an independent harness implementation.

## 10. Recommended clean-room workflow

For stronger separation, use two roles:

1. **Observer:** collects evidence and writes behavior/spec statements without implementation code.
2. **Implementer:** receives only the clean-room spec and synthetic fixtures, not vendor binaries or decompiled code.

That separation makes it much easier to prove your new harness was implemented from behavior rather than copied implementation.
