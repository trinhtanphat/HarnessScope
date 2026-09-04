#![cfg(any(target_os = "linux", target_os = "macos"))]

use harnesscope_collector_sdk::{
    COLLECTOR_SDK_VERSION, CollectorCapability, CollectorEnvelopeKind, CollectorStartRequest,
    CollectorTarget,
};
use harnesscope_collectors::spawn_first_party;
use serde_json::Value;
use std::{
    fs,
    path::PathBuf,
    time::{Duration, Instant},
};
use tempfile::tempdir;

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/collectors/synthetic-target.mjs")
}

fn collector_id() -> &'static str {
    if cfg!(target_os = "linux") {
        "harnesscope.linux.process-files"
    } else {
        "harnesscope.macos.process-files"
    }
}

#[test]
fn observes_only_selected_directory_file_metadata() {
    let temp = tempdir().unwrap();
    let selected = temp.path().join("selected");
    let sibling = temp.path().join("sibling");
    fs::create_dir_all(&selected).unwrap();
    fs::create_dir_all(&sibling).unwrap();

    let request = CollectorStartRequest {
        sdk_version: COLLECTOR_SDK_VERSION.into(),
        collector_id: collector_id().into(),
        instance_id: "native-files".into(),
        requested_capabilities: vec![
            CollectorCapability::ProcessLifecycle,
            CollectorCapability::FileMetadata,
        ],
        paths: vec![selected.to_string_lossy().into_owned()],
        hash_files: false,
        target: Some(CollectorTarget {
            executable: "node".into(),
            args: vec![
                fixture_path().to_string_lossy().into_owned(),
                "--selected".into(),
                selected.to_string_lossy().into_owned(),
                "--sibling".into(),
                sibling.to_string_lossy().into_owned(),
            ],
            cwd: None,
        }),
    };

    let handle = spawn_first_party(request).unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut events = Vec::<Value>::new();
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
    let file_events = events
        .iter()
        .filter(|event| {
            event
                .get("kind")
                .and_then(Value::as_str)
                .is_some_and(|kind| kind.starts_with("File"))
        })
        .collect::<Vec<_>>();
    assert!(
        !file_events.is_empty(),
        "missing file metadata evidence: {events:?}"
    );

    let selected_canonical = fs::canonicalize(&selected).unwrap();
    let sibling_canonical = fs::canonicalize(&sibling).unwrap();
    let selected_text = selected_canonical.to_string_lossy();
    let sibling_text = sibling_canonical.to_string_lossy();
    assert!(file_events.iter().any(|event| {
        event["data"]["path"]
            .as_str()
            .is_some_and(|path| path.starts_with(selected_text.as_ref()))
    }));
    assert!(
        file_events.iter().all(|event| {
            event["data"]["path"]
                .as_str()
                .is_none_or(|path| !path.starts_with(sibling_text.as_ref()))
        }),
        "out-of-scope sibling file event persisted: {file_events:?}"
    );
    assert!(
        file_events
            .iter()
            .all(|event| event["data"]["contentCaptured"] == false)
    );
}
