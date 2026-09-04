use harnesscope_core::{Finding, TraceEventInput, Workspace};
use serde_json::json;
use std::fs;
use tempfile::tempdir;

const FIXTURE: &[u8] = include_bytes!("../../../fixtures/v02-workspace/workspace.sqlite");
const SESSION_ID: &str = "20000000-0000-4000-8000-000000000001";
const EVENT_ID: &str = "20000000-0000-4000-8000-000000000002";
const FINDING_ID: &str = "20000000-0000-4000-8000-000000000003";

#[test]
fn opens_and_extends_released_v02_workspace_without_conversion() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("workspace.sqlite");
    fs::write(&path, FIXTURE).unwrap();

    let workspace = Workspace::open(&path).unwrap();
    let sessions = workspace.list_sessions().unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, SESSION_ID);
    assert_eq!(sessions[0].name, "v0.2 compatibility fixture");
    assert_eq!(sessions[0].created_utc, "2026-09-04T00:00:00.000Z");

    let events = workspace.list_events(SESSION_ID).unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].id, EVENT_ID);
    assert_eq!(events[0].data["Authorization"], "[REDACTED]");
    assert_eq!(events[0].redaction, "redacted");

    let findings = workspace.list_findings(SESSION_ID).unwrap();
    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].id.as_deref(), Some(FINDING_ID));
    assert_eq!(findings[0].evidence_event_ids, vec![EVENT_ID]);

    let created = workspace
        .create_session("rust extension", "desktop")
        .unwrap();
    let stored = workspace
        .append_event(
            &created.id,
            TraceEventInput {
                id: Some("rust-event".into()),
                timestamp_utc: Some("2026-09-04T00:00:02.000Z".into()),
                source: "rust-test".into(),
                kind: "ToolCall".into(),
                correlation_id: Some("tool-rust".into()),
                data: json!({ "name": "read", "Authorization": "Bearer rust-secret-must-not-persist-123456" }),
                redaction: None,
            },
        )
        .unwrap();
    assert_eq!(stored.data["Authorization"], "[REDACTED]");

    workspace
        .replace_findings(
            &created.id,
            &[Finding {
                id: Some("rust-finding".into()),
                session_id: None,
                title: "Rust compatibility finding".into(),
                category: "compatibility_fixture".into(),
                confidence: 0.93,
                statement: "Stored by the Rust v0.3 core.".into(),
                evidence_event_ids: vec!["rust-event".into()],
            }],
        )
        .unwrap();
    drop(workspace);

    let reopened = Workspace::open(&path).unwrap();
    assert!(reopened.get_session(&created.id).unwrap().is_some());
    assert_eq!(reopened.list_events(&created.id).unwrap().len(), 1);
    assert_eq!(reopened.list_findings(&created.id).unwrap().len(), 1);
    drop(reopened);

    let bytes = fs::read(path).unwrap();
    assert!(
        !bytes
            .windows(b"rust-secret-must-not-persist".len())
            .any(|window| { window == b"rust-secret-must-not-persist" })
    );
}
