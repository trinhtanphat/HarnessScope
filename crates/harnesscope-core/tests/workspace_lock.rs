use harnesscope_core::{CoreError, LockConfig, WorkspaceLock, workspace_lock_path};
use serde_json::json;
use std::{fs, time::Duration};
use tempfile::tempdir;

fn test_config() -> LockConfig {
    LockConfig {
        heartbeat_interval: Duration::ZERO,
        stale_after: Duration::from_secs(30),
    }
}

fn write_owner(lock_path: &std::path::Path, pid: u32, token: &str, heartbeat: &str) {
    fs::create_dir_all(lock_path).unwrap();
    fs::write(
        lock_path.join("owner.json"),
        serde_json::to_vec(&json!({
            "token": token,
            "pid": pid,
            "runtime": "rust-test",
            "processStartIdentity": null,
            "acquiredUtc": heartbeat,
            "heartbeatUtc": heartbeat
        }))
        .unwrap(),
    )
    .unwrap();
}

#[test]
fn first_owner_is_exclusive_and_release_is_owner_checked() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("workspace.sqlite");
    let lock_path = workspace_lock_path(&db_path);
    let mut lease = WorkspaceLock::acquire_with_probe(
        &db_path,
        "rust-test",
        101,
        None,
        test_config(),
        |_| Ok(false),
    )
    .unwrap();
    assert!(lock_path.is_dir());

    let second = WorkspaceLock::acquire_with_probe(
        &db_path,
        "rust-other",
        102,
        None,
        test_config(),
        |_| Ok(false),
    );
    assert!(matches!(second, Err(CoreError::WorkspaceLocked)));

    assert!(lease.release().unwrap());
    assert!(!lease.release().unwrap());
    assert!(!lock_path.exists());
}

#[test]
fn stale_lock_requires_confirmed_dead_pid_before_reclamation() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("workspace.sqlite");
    let lock_path = workspace_lock_path(&db_path);
    write_owner(&lock_path, 424242, "stale", "2000-01-01T00:00:00Z");

    let live = WorkspaceLock::acquire_with_probe(
        &db_path,
        "rust-test",
        103,
        None,
        test_config(),
        |_| Ok(true),
    );
    assert!(matches!(live, Err(CoreError::WorkspaceLocked)));

    let unknown = WorkspaceLock::acquire_with_probe(
        &db_path,
        "rust-test",
        103,
        None,
        test_config(),
        |_| Err(CoreError::WorkspaceLocked),
    );
    assert!(matches!(unknown, Err(CoreError::WorkspaceLocked)));

    let mut reclaimed = WorkspaceLock::acquire_with_probe(
        &db_path,
        "rust-test",
        103,
        None,
        test_config(),
        |_| Ok(false),
    )
    .unwrap();
    let owner: serde_json::Value =
        serde_json::from_slice(&fs::read(lock_path.join("owner.json")).unwrap()).unwrap();
    assert_ne!(owner["token"], "stale");
    assert!(reclaimed.release().unwrap());
}

#[test]
fn malformed_owner_metadata_fails_closed_and_refresh_preserves_ownership() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("workspace.sqlite");
    let lock_path = workspace_lock_path(&db_path);
    fs::create_dir_all(&lock_path).unwrap();
    fs::write(lock_path.join("owner.json"), b"{not-json").unwrap();
    let malformed = WorkspaceLock::acquire_with_probe(
        &db_path,
        "rust-test",
        104,
        None,
        test_config(),
        |_| Ok(false),
    );
    assert!(matches!(malformed, Err(CoreError::WorkspaceLocked)));
    fs::remove_dir_all(&lock_path).unwrap();

    let mut lease = WorkspaceLock::acquire_with_probe(
        &db_path,
        "rust-test",
        104,
        None,
        test_config(),
        |_| Ok(false),
    )
    .unwrap();
    let before = fs::read(lock_path.join("owner.json")).unwrap();
    std::thread::sleep(Duration::from_millis(2));
    lease.refresh().unwrap();
    let after = fs::read(lock_path.join("owner.json")).unwrap();
    assert_ne!(before, after);
    assert!(lease.release().unwrap());
}
