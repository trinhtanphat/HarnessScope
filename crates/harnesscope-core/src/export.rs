use crate::{CoreError, Finding, Session, TraceEvent, Workspace};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub out_dir: PathBuf,
    pub files: Vec<String>,
}

fn status_for(finding: &Finding) -> &'static str {
    if finding.confidence >= 0.9 {
        "INFERRED_HIGH"
    } else if finding.confidence >= 0.7 {
        "INFERRED_MEDIUM"
    } else {
        "UNKNOWN"
    }
}

fn observed_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Array(_) => "array",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Object(_) => "object",
    }
}

fn tool_schemas(events: &[TraceEvent]) -> Vec<Value> {
    let mut tools: BTreeMap<String, (usize, BTreeMap<String, BTreeSet<String>>)> = BTreeMap::new();
    for event in events {
        if event.kind != "ToolCall" {
            continue;
        }
        let Some(name) = event.data.get("name").and_then(Value::as_str) else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        let entry = tools
            .entry(name.to_owned())
            .or_insert_with(|| (0, BTreeMap::new()));
        entry.0 += 1;
        if let Some(arguments) = event.data.get("args").and_then(Value::as_object) {
            for (key, value) in arguments {
                entry
                    .1
                    .entry(key.clone())
                    .or_default()
                    .insert(observed_type(value).to_owned());
            }
        }
    }

    tools
        .into_iter()
        .map(|(name, (observed_calls, arguments))| {
            let arguments = arguments
                .into_iter()
                .map(|(key, types)| {
                    (
                        key,
                        json!({
                            "observedTypes": types.into_iter().collect::<Vec<_>>()
                        }),
                    )
                })
                .collect::<Map<_, _>>();
            json!({
                "name": name,
                "observedCalls": observed_calls,
                "arguments": Value::Object(arguments)
            })
        })
        .collect()
}

fn markdown(
    session: &Session,
    events: &[TraceEvent],
    findings: &[Finding],
    schemas: &[Value],
) -> String {
    let kinds = events
        .iter()
        .map(|event| event.kind.clone())
        .collect::<BTreeSet<_>>();
    let mut lines = vec![
        "# HarnessScope Clean-Room Behavioral Spec".to_owned(),
        String::new(),
        format!("- Session: `{}`", session.name),
        format!("- Session ID: `{}`", session.id),
        format!("- Mode: `{}`", session.mode),
        format!("- Evidence events: {}", events.len()),
        format!("- Findings: {}", findings.len()),
        String::new(),
        "> This report describes observed evidence and evidence-backed inference. It is not vendor source truth.".to_owned(),
        String::new(),
        "## Observed event surface".to_owned(),
        String::new(),
    ];
    if kinds.is_empty() {
        lines.push("- UNKNOWN No events were imported.".into());
    } else {
        lines.extend(kinds.into_iter().map(|kind| format!("- OBSERVED `{kind}`")));
    }
    lines.extend([
        String::new(),
        "## Candidate tool surface".to_owned(),
        String::new(),
    ]);
    if schemas.is_empty() {
        lines.push("- UNKNOWN No tool calls were observed.".into());
    }
    for schema in schemas {
        let name = schema.get("name").and_then(Value::as_str).unwrap_or("");
        let calls = schema
            .get("observedCalls")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let arguments = schema
            .get("arguments")
            .and_then(Value::as_object)
            .map(|value| value.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        let argument_text = if arguments.is_empty() {
            "(none observed)".to_owned()
        } else {
            arguments.join(", ")
        };
        lines.push(format!(
            "- OBSERVED `{name}` — {calls} call(s); argument keys: {argument_text}"
        ));
    }
    lines.extend([String::new(), "## Findings".to_owned(), String::new()]);
    if findings.is_empty() {
        lines.push("- UNKNOWN No evidence-backed findings were produced.".into());
    }
    for finding in findings {
        let evidence = if finding.evidence_event_ids.is_empty() {
            "none".to_owned()
        } else {
            finding
                .evidence_event_ids
                .iter()
                .map(|id| format!("`{id}`"))
                .collect::<Vec<_>>()
                .join(", ")
        };
        lines.extend([
            format!("### {} — {}", status_for(finding), finding.title),
            String::new(),
            finding.statement.clone(),
            String::new(),
            format!("Confidence: {:.2}", finding.confidence),
            String::new(),
            format!("Evidence: {evidence}"),
            String::new(),
        ]);
    }
    format!("{}\n", lines.join("\n").trim_end())
}

fn json_text(value: &Value) -> Result<String, CoreError> {
    Ok(format!("{}\n", serde_json::to_string_pretty(value)?))
}

fn safe_tool_filename(name: &str) -> String {
    name.chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

pub fn export_session(
    workspace: &Workspace,
    session_id: &str,
    out_dir: &Path,
) -> Result<ExportResult, CoreError> {
    let session = workspace
        .get_session(session_id)?
        .ok_or_else(|| CoreError::InvalidData(format!("Session not found: {session_id}")))?;
    let events = workspace.list_events(session_id)?;
    let findings = workspace.list_findings(session_id)?;
    let schemas = tool_schemas(&events);
    let event_kinds = events
        .iter()
        .map(|event| event.kind.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let exported_findings = findings
        .iter()
        .map(|finding| {
            let mut evidence = finding.evidence_event_ids.clone();
            evidence.sort();
            json!({
                "status": status_for(finding),
                "title": finding.title,
                "category": finding.category,
                "confidence": finding.confidence,
                "statement": finding.statement,
                "evidenceEventIds": evidence
            })
        })
        .collect::<Vec<_>>();
    let spec = json!({
        "format": "harnesscope.cleanroom-spec.v1",
        "session": session,
        "evidence": {
            "eventCount": events.len(),
            "eventKinds": event_kinds
        },
        "tools": schemas,
        "findings": exported_findings
    });

    if let Some(parent) = out_dir.parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)?;
    }
    let temp = PathBuf::from(format!(
        "{}.tmp-{}",
        out_dir.to_string_lossy(),
        Uuid::new_v4()
    ));
    let result = (|| {
        let tool_dir = temp.join("tool-schemas");
        fs::create_dir_all(&tool_dir)?;
        fs::write(
            temp.join("harness-spec.md"),
            markdown(&session, &events, &findings, &schemas),
        )?;
        fs::write(temp.join("harness-spec.json"), json_text(&spec)?)?;
        let mut files = vec!["harness-spec.md".to_owned(), "harness-spec.json".to_owned()];
        for schema in &schemas {
            let name = schema.get("name").and_then(Value::as_str).unwrap_or("");
            let filename = format!("{}.json", safe_tool_filename(name));
            fs::write(tool_dir.join(&filename), json_text(schema)?)?;
            files.push(format!("tool-schemas/{filename}"));
        }
        if out_dir.exists() {
            fs::remove_dir_all(out_dir)?;
        }
        fs::rename(&temp, out_dir)?;
        Ok::<_, CoreError>(files)
    })();

    match result {
        Ok(files) => Ok(ExportResult {
            out_dir: out_dir.to_path_buf(),
            files,
        }),
        Err(error) => {
            let _ = fs::remove_dir_all(&temp);
            Err(error)
        }
    }
}
