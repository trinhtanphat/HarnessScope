use harnesscope_core::{AppServices, LaunchRequest, workspace_lock_path};
use std::path::PathBuf;
use tempfile::tempdir;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn fixture(name: &str) -> PathBuf {
    repo_root().join("fixtures").join(name)
}

fn assert_serializable<T: serde::Serialize>(value: &T) {
    serde_json::to_value(value).expect("service value must serialize");
}

#[test]
fn application_services_cover_desktop_core_operations_with_explicit_paths() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("workspace.sqlite");
    let services = AppServices::open(&db_path, "HarnessScope", "0.3.0", "test").unwrap();
    assert!(workspace_lock_path(&db_path).exists());

    let app = services.app_info();
    assert_eq!(app.name, "HarnessScope");
    assert_eq!(app.version, "0.3.0");
    assert_serializable(&app);
    let workspace = services.workspace_info();
    assert_eq!(workspace.db_path, db_path);
    assert_serializable(&workspace);

    let a = services.session_create("A", "desktop").unwrap();
    let b = services.session_create("B", "cli").unwrap();
    assert_serializable(&a);
    let sessions = services.session_list().unwrap();
    assert_eq!(sessions.len(), 2);
    assert_serializable(&sessions);

    let imported = services.import_har(&a.id, &fixture("sample.har")).unwrap();
    assert_eq!(imported.imported, 2);
    assert_serializable(&imported);
    let timeline = services.timeline_get(&a.id).unwrap();
    assert_eq!(timeline.session.id, a.id);
    assert_eq!(timeline.events.len(), 2);
    assert_serializable(&timeline);

    let inferred = services.inference_run(&a.id).unwrap();
    assert_eq!(inferred.session.id, a.id);
    assert_serializable(&inferred);
    let compared = services.compare_run(&a.id, &b.id).unwrap();
    assert_serializable(&compared);

    let launched = services
        .launch_run(
            &a.id,
            LaunchRequest {
                target: "node".into(),
                args: vec![fixture("dummy-agent.mjs").to_string_lossy().to_string()],
                cwd: Some(repo_root()),
            },
        )
        .unwrap();
    assert_eq!(launched.exit_code, Some(0));
    assert_serializable(&launched);

    let out = dir.path().join("export");
    let exported = services.export_run(&a.id, &out).unwrap();
    assert!(out.join("harness-spec.json").is_file());
    assert_serializable(&exported);

    drop(services);
    assert!(!workspace_lock_path(&db_path).exists());
}

#[test]
fn application_services_fail_closed_with_stable_error_codes() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("workspace.sqlite");
    let services = AppServices::open(&db_path, "HarnessScope", "0.3.0", "test").unwrap();

    let second = AppServices::open(&db_path, "HarnessScope", "0.3.0", "test").unwrap_err();
    assert_eq!(second.code(), "WORKSPACE_LOCKED");
    assert_eq!(
        services.timeline_get("missing-session").unwrap_err().code(),
        "SESSION_NOT_FOUND"
    );
    assert_eq!(
        services.session_create("", "desktop").unwrap_err().code(),
        "INVALID_ARGUMENT"
    );
    assert_eq!(
        services
            .import_har("missing-session", &fixture("sample.har"))
            .unwrap_err()
            .code(),
        "SESSION_NOT_FOUND"
    );
}
