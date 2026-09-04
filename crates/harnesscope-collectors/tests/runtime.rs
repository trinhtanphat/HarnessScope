use harnesscope_collector_sdk::{COLLECTOR_SDK_VERSION, CollectorCapability};
#[cfg(any(target_os = "linux", target_os = "macos"))]
use harnesscope_collector_sdk::{CollectorStartRequest, CollectorStatus, CollectorTarget};
use harnesscope_collectors::first_party_manifests;
#[cfg(any(target_os = "linux", target_os = "macos"))]
use harnesscope_collectors::spawn_first_party;
#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::{path::PathBuf, time::Duration};

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/collectors/synthetic-target.mjs")
}

fn platform_collector_id() -> Option<&'static str> {
    if cfg!(target_os = "linux") {
        Some("harnesscope.linux.process-files")
    } else if cfg!(target_os = "macos") {
        Some("harnesscope.macos.process-files")
    } else {
        None
    }
}

#[test]
fn first_party_manifest_matches_current_platform_only() {
    let manifests = first_party_manifests();
    match platform_collector_id() {
        Some(id) => {
            assert_eq!(manifests.len(), 1);
            let manifest = &manifests[0];
            assert_eq!(manifest.sdk_version, COLLECTOR_SDK_VERSION);
            assert_eq!(manifest.id, id);
            assert_eq!(manifest.version, "0.4.0");
            assert!(
                manifest
                    .capabilities
                    .contains(&CollectorCapability::ProcessLifecycle)
            );
            assert!(
                manifest
                    .capabilities
                    .contains(&CollectorCapability::FileMetadata)
            );
            assert!(manifest.requires_explicit_paths);
            assert!(manifest.requires_target_launch);
            assert_eq!(manifest.content_capture, "unsupported");
        }
        None => assert!(manifests.is_empty()),
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn owned_collector_can_be_stopped_idempotently() {
    let request = CollectorStartRequest {
        sdk_version: COLLECTOR_SDK_VERSION.into(),
        collector_id: platform_collector_id().unwrap().into(),
        instance_id: "runtime-stop".into(),
        requested_capabilities: vec![CollectorCapability::ProcessLifecycle],
        paths: vec![],
        hash_files: false,
        target: Some(CollectorTarget {
            executable: "node".into(),
            args: vec![
                fixture_path().to_string_lossy().into_owned(),
                "--hold-ms".into(),
                "5000".into(),
            ],
            cwd: None,
        }),
    };
    let handle = spawn_first_party(request).unwrap();
    assert!(matches!(
        handle.status(),
        CollectorStatus::Starting | CollectorStatus::Running
    ));
    let stopped = handle.stop(Duration::from_secs(3)).unwrap();
    assert_eq!(stopped, CollectorStatus::Stopped);
    assert_eq!(
        handle.stop(Duration::from_millis(100)).unwrap(),
        CollectorStatus::Stopped
    );
}
