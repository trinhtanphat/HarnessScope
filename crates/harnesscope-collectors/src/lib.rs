mod files;
mod process;
mod runtime;

use harnesscope_collector_sdk::{
    COLLECTOR_SDK_VERSION, CollectorCapability, CollectorManifest,
};

pub use runtime::{CollectorHandle, CollectorRuntimeError, spawn_first_party};

pub fn first_party_manifests() -> Vec<CollectorManifest> {
    let (id, platform) = if cfg!(target_os = "linux") {
        ("harnesscope.linux.process-files", "linux")
    } else if cfg!(target_os = "macos") {
        ("harnesscope.macos.process-files", "macos")
    } else {
        return Vec::new();
    };

    vec![CollectorManifest {
        sdk_version: COLLECTOR_SDK_VERSION.into(),
        id: id.into(),
        name: "HarnessScope Native Process + File Collector".into(),
        version: "0.4.0".into(),
        platforms: vec![platform.into()],
        capabilities: vec![
            CollectorCapability::ProcessLifecycle,
            CollectorCapability::ProcessMetadata,
            CollectorCapability::FileMetadata,
            CollectorCapability::CollectorDiagnostics,
        ],
        requires_explicit_paths: true,
        requires_target_launch: true,
        content_capture: "unsupported".into(),
    }]
}
