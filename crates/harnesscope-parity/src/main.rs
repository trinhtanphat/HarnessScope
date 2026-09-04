use harnesscope_core::{
    Finding, SessionSnapshot, TraceEvent, TraceEventInput, Workspace, compare_sessions,
    export_session, import_har, import_jsonl, import_procmon, infer_findings, redact_value,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::BTreeMap, env, fs, path::Path, process::ExitCode};
use tempfile::tempdir;

#[derive(Deserialize)]
struct CompareFixture {
    a: SessionSnapshot,
    b: SessionSnapshot,
}

fn export_parity(path: &Path) -> Result<Value, Box<dyn std::error::Error>> {
    let temp = tempdir()?;
    let db_path = temp.path().join("workspace.sqlite");
    let out = temp.path().join("out");
    fs::copy(path, &db_path)?;
    let workspace = Workspace::open(&db_path)?;
    let session_id = "20000000-0000-4000-8000-000000000001";
    let event = workspace.append_event(
        session_id,
        TraceEventInput {
            id: Some("event-tool".into()),
            timestamp_utc: Some("2026-09-04T00:00:01.000Z".into()),
            source: "fixture".into(),
            kind: "ToolCall".into(),
            correlation_id: Some("t1".into()),
            data: json!({"name":"shell","args":{"api_key":"must-not-export","command":"npm test"}}),
            redaction: None,
        },
    )?;
    workspace.replace_findings(
        session_id,
        &[Finding {
            id: Some("finding-tool".into()),
            session_id: None,
            title: "Observed tool schema: shell".into(),
            category: "tool_schema".into(),
            confidence: 0.95,
            statement: "Observed shell command argument.".into(),
            evidence_event_ids: vec![event.id],
        }],
    )?;
    export_session(&workspace, session_id, &out)?;

    let mut tool_schemas = BTreeMap::new();
    for entry in fs::read_dir(out.join("tool-schemas"))? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        tool_schemas.insert(name, fs::read_to_string(entry.path())?);
    }
    Ok(json!({
        "spec": fs::read_to_string(out.join("harness-spec.json"))?,
        "markdown": fs::read_to_string(out.join("harness-spec.md"))?,
        "toolSchemas": tool_schemas
    }))
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let case = args.next().ok_or("missing parity case")?;
    let fixture = args.next().ok_or("missing fixture path")?;
    if args.next().is_some() {
        return Err("too many arguments".into());
    }

    match case.as_str() {
        "model-roundtrip" => {
            let text = fs::read_to_string(fixture)?;
            let snapshot: SessionSnapshot = serde_json::from_str(&text)?;
            println!("{}", serde_json::to_string(&snapshot)?);
            Ok(())
        }
        "redaction" => {
            let text = fs::read_to_string(fixture)?;
            let items: Vec<Value> = serde_json::from_str(&text)?;
            let output = items
                .iter()
                .map(|item| {
                    let value = item.get("value").unwrap_or(&Value::Null);
                    let key_hint = item.get("keyHint").and_then(Value::as_str).unwrap_or("");
                    redact_value(value, key_hint)
                })
                .collect::<Vec<_>>();
            println!("{}", serde_json::to_string(&output)?);
            Ok(())
        }
        "inference" => {
            let text = fs::read_to_string(fixture)?;
            let events: Vec<TraceEvent> = serde_json::from_str(&text)?;
            println!("{}", serde_json::to_string(&infer_findings(&events))?);
            Ok(())
        }
        "compare" => {
            let text = fs::read_to_string(fixture)?;
            let fixture: CompareFixture = serde_json::from_str(&text)?;
            println!(
                "{}",
                serde_json::to_string(&compare_sessions(&fixture.a, &fixture.b))?
            );
            Ok(())
        }
        "imports-har" => {
            println!(
                "{}",
                serde_json::to_string(&import_har(Path::new(&fixture))?)?
            );
            Ok(())
        }
        "imports-procmon" => {
            println!(
                "{}",
                serde_json::to_string(&import_procmon(Path::new(&fixture), "2026-09-04")?)?
            );
            Ok(())
        }
        "imports-jsonl" => {
            let fixture_path = Path::new(&fixture);
            let map_path = fixture_path
                .parent()
                .ok_or("JSONL fixture requires parent")?
                .join("sample-map.yaml");
            println!(
                "{}",
                serde_json::to_string(&import_jsonl(fixture_path, &map_path)?)?
            );
            Ok(())
        }
        "export" => {
            println!("{}", serde_json::to_string(&export_parity(Path::new(&fixture))?)?);
            Ok(())
        }
        _ => Err(format!("unsupported parity case: {case}").into()),
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(2)
        }
    }
}
