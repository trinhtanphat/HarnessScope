use harnesscope_core::{LaunchRequest, WatchRequest, Workspace, launch_target, watch_files};
use std::{fs, path::PathBuf, thread, time::Duration};
use tempfile::tempdir;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[test]
fn launch_captures_only_structured_stdout_and_drains_pipes_before_return() {
    let dir = tempdir().unwrap();
    let workspace = Workspace::open(dir.path().join("workspace.sqlite")).unwrap();
    let session = workspace.create_session("observe", "test").unwrap();
    let script = repo_root().join("fixtures/dummy-agent.mjs");

    let result = launch_target(
        &workspace,
        &session.id,
        LaunchRequest {
            target: "node".into(),
            args: vec![script.to_string_lossy().to_string()],
            cwd: Some(repo_root()),
        },
    )
    .unwrap();

    assert!(result.pid > 0);
    assert_eq!(result.exit_code, Some(0));
    assert_eq!(result.signal, None);
    let events = workspace.list_events(&session.id).unwrap();
    assert_eq!(events.first().unwrap().kind, "ProcessStarted");
    assert_eq!(events.last().unwrap().kind, "ProcessExited");
    assert_eq!(result.events_captured, events.len());
    assert_eq!(
        events
            .iter()
            .filter(|event| event.kind == "SkillRead")
            .count(),
        1
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| event.kind == "CompactionMarker")
            .count(),
        1
    );
}

#[test]
fn launch_ignores_arbitrary_output_and_persists_only_safe_malformed_marker_diagnostic() {
    let dir = tempdir().unwrap();
    let workspace = Workspace::open(dir.path().join("workspace.sqlite")).unwrap();
    let session = workspace.create_session("malformed", "test").unwrap();
    let script = dir.path().join("agent.mjs");
    fs::write(
        &script,
        r#"console.log('ordinary-secret-output');
console.error('stderr-secret-output');
console.log('HARNESSCOPE_EVENT {not-json');
console.log('HARNESSCOPE_EVENT ' + JSON.stringify({kind:'ToolCall',correlationId:'tail',data:{name:'tail',args:{path:'x'}}}));
"#,
    )
    .unwrap();

    launch_target(
        &workspace,
        &session.id,
        LaunchRequest {
            target: "node".into(),
            args: vec![script.to_string_lossy().to_string()],
            cwd: Some(dir.path().to_path_buf()),
        },
    )
    .unwrap();

    let events = workspace.list_events(&session.id).unwrap();
    assert!(events.iter().any(|event| {
        event.kind == "Unknown"
            && event.data["diagnostic"]
                == "Malformed HARNESSCOPE_EVENT marker omitted from persistence."
    }));
    assert!(
        events
            .iter()
            .any(|event| event.kind == "ToolCall" && event.data["name"] == "tail")
    );
    let persisted = serde_json::to_string(&events).unwrap();
    assert!(!persisted.contains("ordinary-secret-output"));
    assert!(!persisted.contains("stderr-secret-output"));
    assert!(!persisted.contains("{not-json"));
}

#[test]
fn file_watch_records_metadata_only_for_new_or_changed_files() {
    let db_dir = tempdir().unwrap();
    let watch_dir = tempdir().unwrap();
    let workspace = Workspace::open(db_dir.path().join("workspace.sqlite")).unwrap();
    let session = workspace.create_session("watch", "test").unwrap();
    let target = watch_dir.path().join("changed.txt");
    fs::write(&target, "before").unwrap();
    let target_for_thread = target.clone();
    let writer = thread::spawn(move || {
        thread::sleep(Duration::from_millis(120));
        fs::write(target_for_thread, "file-secret-content-must-not-persist").unwrap();
    });

    let result = watch_files(
        &workspace,
        &session.id,
        WatchRequest {
            path: watch_dir.path().to_path_buf(),
            seconds: 1,
            interval_ms: 50,
        },
    )
    .unwrap();
    writer.join().unwrap();

    assert_eq!(result.path, watch_dir.path().canonicalize().unwrap());
    assert!(result.events_captured >= 1);
    let events = workspace.list_events(&session.id).unwrap();
    let writes = events
        .iter()
        .filter(|event| event.kind == "FileWritten")
        .collect::<Vec<_>>();
    assert!(!writes.is_empty());
    assert!(
        writes
            .iter()
            .all(|event| event.data["contentCaptured"] == false)
    );
    let persisted = serde_json::to_string(&writes).unwrap();
    assert!(!persisted.contains("file-secret-content-must-not-persist"));
}
