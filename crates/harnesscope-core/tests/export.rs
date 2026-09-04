use harnesscope_core::{export_session, Finding, TraceEventInput, Workspace};
use serde_json::json;
use std::{fs, path::PathBuf};
use tempfile::tempdir;

const SESSION_ID: &str = "20000000-0000-4000-8000-000000000001";
const FIXTURE: &[u8] = include_bytes!("../../../fixtures/v02-workspace/workspace.sqlite");

#[test]
fn exporter_is_deterministic_matches_clean_room_contract_and_never_leaks_secrets() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("workspace.sqlite");
    fs::write(&db_path, FIXTURE).unwrap();
    let workspace = Workspace::open(&db_path).unwrap();
    let event = workspace
        .append_event(
            SESSION_ID,
            TraceEventInput {
                id: Some("event-tool".into()),
                timestamp_utc: Some("2026-09-04T00:00:01.000Z".into()),
                source: "fixture".into(),
                kind: "ToolCall".into(),
                correlation_id: Some("t1".into()),
                data: json!({"name":"shell","args":{"command":"npm test","api_key":"must-not-export"}}),
                redaction: None,
            },
        )
        .unwrap();
    workspace
        .replace_findings(
            SESSION_ID,
            &[Finding {
                id: Some("finding-tool".into()),
                session_id: None,
                title: "Observed tool schema: shell".into(),
                category: "tool_schema".into(),
                confidence: 0.95,
                statement: "Observed shell command argument.".into(),
                evidence_event_ids: vec![event.id],
            }],
        )
        .unwrap();

    let out = dir.path().join("out");
    let result = export_session(&workspace, SESSION_ID, &out).unwrap();
    assert_eq!(result.files, vec!["harness-spec.md", "harness-spec.json", "tool-schemas/shell.json"]);

    let md = fs::read_to_string(out.join("harness-spec.md")).unwrap();
    let spec = fs::read_to_string(out.join("harness-spec.json")).unwrap();
    let schema = fs::read_to_string(out.join("tool-schemas/shell.json")).unwrap();
    assert!(md.contains("# HarnessScope Clean-Room Behavioral Spec"));
    assert!(md.contains("INFERRED_HIGH"));
    assert!(schema.contains("command"));
    assert!(schema.contains("string"));
    assert!(!(md.clone() + &spec + &schema).contains("must-not-export"));

    let first = fs::read(out.join("harness-spec.json")).unwrap();
    export_session(&workspace, SESSION_ID, &out).unwrap();
    assert_eq!(fs::read(out.join("harness-spec.json")).unwrap(), first);

    let parsed: serde_json::Value = serde_json::from_str(&spec).unwrap();
    assert_eq!(parsed["format"], "harnesscope.cleanroom-spec.v1");
    assert_eq!(parsed["tools"][0]["name"], "shell");
    assert_eq!(parsed["findings"][0]["status"], "INFERRED_HIGH");
}

#[test]
fn exporter_rejects_missing_session_without_partial_output() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("workspace.sqlite");
    let workspace = Workspace::open(&db_path).unwrap();
    let out = PathBuf::from(dir.path()).join("missing-out");
    assert!(export_session(&workspace, "missing-session", &out).is_err());
    assert!(!out.exists());
}
