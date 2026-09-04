use harnesscope_core::{import_har, import_jsonl, import_procmon};
use serde_json::Value;
use std::path::PathBuf;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("fixtures")
        .join(name)
}

#[test]
fn har_import_matches_node_semantics_and_redacts_before_return() {
    let events = import_har(&fixture("sample.har")).expect("HAR import");
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].kind, "HttpRequest");
    assert_eq!(events[1].kind, "HttpResponse");
    assert_eq!(
        events[0].timestamp_utc.as_deref(),
        Some("2026-09-04T00:00:00.000Z")
    );
    assert_eq!(events[1].timestamp_utc, events[0].timestamp_utc);
    assert_eq!(events[0].correlation_id, events[1].correlation_id);
    assert!(
        events[0]
            .correlation_id
            .as_deref()
            .is_some_and(|value| !value.is_empty())
    );
    assert_eq!(events[0].data["method"], "POST");
    assert_eq!(events[0].data["headers"]["Authorization"], "[REDACTED]");
    assert_eq!(events[0].data["body"]["api_key"], "[REDACTED]");
    assert_eq!(events[1].data["headers"]["Set-Cookie"], "[REDACTED]");
    assert_eq!(events[0].redaction.as_deref(), Some("redacted"));
    assert_eq!(events[1].redaction.as_deref(), Some("redacted"));
    let text = serde_json::to_string(&events).unwrap();
    for secret in [
        "supersecret",
        "secret-query",
        "secret-cookie",
        "secret-body",
    ] {
        assert!(!text.contains(secret), "secret leaked: {secret}");
    }
}

#[test]
fn procmon_import_matches_node_operation_and_timestamp_mapping() {
    let events =
        import_procmon(&fixture("sample-procmon.csv"), "2026-09-04").expect("Procmon import");
    assert_eq!(
        events
            .iter()
            .map(|event| event.kind.as_str())
            .collect::<Vec<_>>(),
        vec!["ProcessStarted", "FileRead", "FileWritten"]
    );
    assert_eq!(
        events[0].timestamp_utc.as_deref(),
        Some("2026-09-04T00:00:01.000Z")
    );
    assert_eq!(events[1].data["path"], r"C:\project\skills\frontend.md");
    assert_eq!(events[0].data["pid"], 100);
    assert_eq!(events[0].data["childPid"], 101);
    assert_eq!(events[0].data["commandLine"], "child.exe --work");
    assert_eq!(events[0].correlation_id.as_deref(), Some("100"));
}

#[test]
fn jsonl_import_matches_small_mapping_grammar_and_known_kind_names() {
    let events =
        import_jsonl(&fixture("sample.jsonl"), &fixture("sample-map.yaml")).expect("JSONL import");
    assert_eq!(
        events
            .iter()
            .map(|event| event.kind.as_str())
            .collect::<Vec<_>>(),
        vec!["PermissionPrompt", "PermissionDecision"]
    );
    assert_eq!(events[0].source, "external-jsonl");
    assert_eq!(events[0].correlation_id.as_deref(), Some("p1"));
    assert_eq!(
        events[0].timestamp_utc.as_deref(),
        Some("2026-09-04T00:00:02.000Z")
    );
    assert_eq!(events[0].data["action"], Value::String("shell".into()));
    assert_eq!(events[1].data["decision"], "allow");
}
