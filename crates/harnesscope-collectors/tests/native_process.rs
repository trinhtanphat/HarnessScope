#![cfg(any(target_os = "linux", target_os = "macos"))]

use harnesscope_collector_sdk::{
    COLLECTOR_SDK_VERSION, CollectorCapability, CollectorEnvelopeKind, CollectorStartRequest,
    CollectorTarget,
};
use harnesscope_collectors::spawn_first_party;
use serde_json::Value;
use std::{path::PathBuf, time::{Duration, Instant}};

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/collectors/synthetic-target.mjs")
}

fn collector_id() -> &'static str {
    if cfg!(target_os = "linux") {
        "harnesscope.linux.process-files"
    } else {
        "harnesscope.macos.process-files"
    }
}

fn event_kind(event: &Value) -> Option<&str> {
    event.get("kind").and_then(Value::as_str)
}

#[test]
fn observes_owned_root_and_attributable_descendant_lifecycle() {
    let request = CollectorStartRequest {
        sdk_version: COLLECTOR_SDK_VERSION.into(),
        collector_id: collector_id().into(),
        instance_id: "native-process".into(),
        requested_capabilities: vec![
            CollectorCapability::ProcessLifecycle,
            CollectorCapability::ProcessMetadata,
        ],
        paths: vec![],
        hash_files: false,
        target: Some(CollectorTarget {
            executable: "node".into(),
            args: vec![fixture_path().to_string_lossy().into_owned()],
            cwd: None,
        }),
    };

    let handle = spawn_first_party(request).unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut events = Vec::new();
    let mut completed = false;
    while Instant::now() < deadline && !completed {
        if let Ok(envelope) = handle.recv_timeout(Duration::from_millis(500)) {
            match envelope.kind {
                CollectorEnvelopeKind::Event => events.push(envelope.event.unwrap()),
                CollectorEnvelopeKind::Completed => completed = true,
                _ => {}
            }
        }
    }

    assert!(completed, "collector did not complete");
    let started = events.iter().filter(|event| event_kind(event) == Some("ProcessStarted")).collect::<Vec<_>>();
    let exited = events.iter().filter(|event| event_kind(event) == Some("ProcessExited")).collect::<Vec<_>>();
    assert!(!started.is_empty(), "missing ProcessStarted evidence: {events:?}");
    assert!(!exited.is_empty(), "missing ProcessExited evidence: {events:?}");

    let root_pid = started[0]["data"]["pid"].as_u64().expect("root pid");
    assert!(exited.iter().any(|event| event["data"]["pid"].as_u64() == Some(root_pid)));
    assert!(
        started.iter().any(|event| event["data"]["pid"].as_u64().is_some_and(|pid| pid != root_pid)),
        "expected an attributable descendant ProcessStarted event: {events:?}",
    );
}
