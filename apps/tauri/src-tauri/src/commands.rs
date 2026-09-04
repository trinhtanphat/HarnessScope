use crate::{
    errors,
    state::{CollectorInstance, DesktopState},
};
use harnesscope_collector_sdk::{
    COLLECTOR_SDK_VERSION, CollectorEnvelopeKind, CollectorManifest, CollectorStartRequest,
    CollectorStatus, CollectorTarget,
};
use harnesscope_collectors::{first_party_manifests, spawn_first_party};
use harnesscope_core::{
    AppInfo, CompareResult, ImportResult, InferenceResult, LaunchRequest, LaunchResult,
    OperationEnvelope, ServiceExportResult, Session, SessionSnapshot, TraceEventInput,
    WorkspaceInfo,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{path::PathBuf, sync::Arc, thread, time::Duration};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCreateInput {
    name: String,
    mode: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogFilter {
    name: String,
    extensions: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectorStartInput {
    collector_id: String,
    #[serde(default)]
    paths: Vec<String>,
    #[serde(default)]
    hash_files: bool,
    target: CollectorTarget,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectorInstanceStatus {
    instance_id: String,
    collector_id: String,
    session_id: String,
    status: CollectorStatus,
    diagnostics: Vec<harnesscope_collector_sdk::CollectorDiagnostic>,
}

fn with_services<T>(
    state: &State<'_, DesktopState>,
    operation: impl FnOnce(&harnesscope_core::AppServices) -> Result<T, harnesscope_core::CoreError>,
) -> OperationEnvelope<T> {
    match state.with_services(operation) {
        Ok(result) => errors::from_core(result),
        Err(()) => errors::state_failure(),
    }
}

fn collector_failure<T>(code: &str, message: &str) -> OperationEnvelope<T> {
    OperationEnvelope::failure(code, message)
}

fn collector_snapshot(instance_id: &str, instance: &CollectorInstance) -> CollectorInstanceStatus {
    let diagnostics = instance
        .diagnostics
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    CollectorInstanceStatus {
        instance_id: instance_id.to_owned(),
        collector_id: instance.collector_id.clone(),
        session_id: instance.session_id.clone(),
        status: instance.handle.status(),
        diagnostics,
    }
}

#[tauri::command]
pub fn app_info(state: State<'_, DesktopState>) -> OperationEnvelope<AppInfo> {
    match state.with_services(|services| services.app_info()) {
        Ok(value) => OperationEnvelope::success(value),
        Err(()) => errors::state_failure(),
    }
}

#[tauri::command]
pub fn workspace_info(state: State<'_, DesktopState>) -> OperationEnvelope<WorkspaceInfo> {
    match state.with_services(|services| services.workspace_info()) {
        Ok(value) => OperationEnvelope::success(value),
        Err(()) => errors::state_failure(),
    }
}

#[tauri::command]
pub fn session_list(state: State<'_, DesktopState>) -> OperationEnvelope<Vec<Session>> {
    with_services(&state, |services| services.session_list())
}

#[tauri::command]
pub fn session_create(
    state: State<'_, DesktopState>,
    input: SessionCreateInput,
) -> OperationEnvelope<Session> {
    with_services(&state, |services| {
        services.session_create(&input.name, &input.mode)
    })
}

#[tauri::command]
pub fn timeline_get(
    state: State<'_, DesktopState>,
    session_id: String,
) -> OperationEnvelope<SessionSnapshot> {
    with_services(&state, |services| services.timeline_get(&session_id))
}

#[tauri::command(async)]
pub fn inference_run(
    state: State<'_, DesktopState>,
    session_id: String,
) -> OperationEnvelope<InferenceResult> {
    with_services(&state, |services| services.inference_run(&session_id))
}

#[tauri::command(async)]
pub fn compare_run(
    state: State<'_, DesktopState>,
    session_a: String,
    session_b: String,
) -> OperationEnvelope<CompareResult> {
    with_services(&state, |services| {
        services.compare_run(&session_a, &session_b)
    })
}

#[tauri::command(async)]
pub fn import_har(
    state: State<'_, DesktopState>,
    session_id: String,
    path: PathBuf,
) -> OperationEnvelope<ImportResult> {
    with_services(&state, |services| services.import_har(&session_id, &path))
}

#[tauri::command(async)]
pub fn import_procmon(
    state: State<'_, DesktopState>,
    session_id: String,
    path: PathBuf,
) -> OperationEnvelope<ImportResult> {
    with_services(&state, |services| {
        services.import_procmon(&session_id, &path)
    })
}

#[tauri::command(async)]
pub fn import_jsonl(
    state: State<'_, DesktopState>,
    session_id: String,
    path: PathBuf,
    map_path: PathBuf,
) -> OperationEnvelope<ImportResult> {
    with_services(&state, |services| {
        services.import_jsonl(&session_id, &path, &map_path)
    })
}

#[tauri::command(async)]
pub fn launch_run(
    state: State<'_, DesktopState>,
    session_id: String,
    request: LaunchRequest,
) -> OperationEnvelope<LaunchResult> {
    with_services(&state, |services| services.launch_run(&session_id, request))
}

#[tauri::command(async)]
pub fn export_run(
    state: State<'_, DesktopState>,
    session_id: String,
    out_dir: PathBuf,
) -> OperationEnvelope<ServiceExportResult> {
    with_services(&state, |services| {
        services.export_run(&session_id, &out_dir)
    })
}

#[tauri::command]
pub fn collector_list() -> OperationEnvelope<Vec<CollectorManifest>> {
    OperationEnvelope::success(first_party_manifests())
}

#[tauri::command]
pub fn collector_describe(collector_id: String) -> OperationEnvelope<Option<CollectorManifest>> {
    if collector_id.trim().is_empty() {
        return collector_failure("INVALID_COLLECTOR_REQUEST", "Collector id is invalid.");
    }
    let value = first_party_manifests()
        .into_iter()
        .find(|manifest| manifest.id == collector_id);
    OperationEnvelope::success(value)
}

#[tauri::command(async)]
pub fn collector_start(
    state: State<'_, DesktopState>,
    session_id: String,
    request: CollectorStartInput,
) -> OperationEnvelope<CollectorInstanceStatus> {
    match state.with_services(|services| services.timeline_get(&session_id).map(|_| ())) {
        Ok(Ok(())) => {}
        Ok(Err(error)) => return errors::from_core::<CollectorInstanceStatus>(Err(error)),
        Err(()) => return errors::state_failure(),
    }

    let manifest = match first_party_manifests()
        .into_iter()
        .find(|manifest| manifest.id == request.collector_id)
    {
        Some(manifest) => manifest,
        None => {
            return collector_failure(
                "COLLECTOR_NOT_AVAILABLE",
                "The requested collector is unavailable on this platform.",
            );
        }
    };

    let instance_id = Uuid::new_v4().to_string();
    let collector_id = manifest.id.clone();
    let runtime_request = CollectorStartRequest {
        sdk_version: COLLECTOR_SDK_VERSION.into(),
        collector_id: collector_id.clone(),
        instance_id: instance_id.clone(),
        requested_capabilities: manifest.capabilities.clone(),
        paths: request.paths,
        hash_files: request.hash_files,
        target: Some(request.target),
    };

    let handle = match spawn_first_party(runtime_request) {
        Ok(handle) => Arc::new(handle),
        Err(_) => {
            return collector_failure(
                "COLLECTOR_START_FAILED",
                "The requested first-party collector could not be started.",
            );
        }
    };
    let diagnostics = Arc::new(std::sync::Mutex::new(Vec::new()));
    let instance = CollectorInstance {
        collector_id: collector_id.clone(),
        session_id: session_id.clone(),
        handle: Arc::clone(&handle),
        diagnostics: Arc::clone(&diagnostics),
    };
    if state
        .insert_collector(instance_id.clone(), instance.clone())
        .is_err()
    {
        let _ = handle.stop(Duration::from_secs(2));
        return collector_failure("COLLECTOR_STATE_FAILED", "Collector state is unavailable.");
    }

    let services = state.services_arc();
    let drain_handle = Arc::clone(&handle);
    let drain_instance_id = instance_id.clone();
    let drain_collector_id = collector_id.clone();
    let drain_session_id = session_id.clone();
    thread::spawn(move || {
        loop {
            match drain_handle.recv_timeout(Duration::from_millis(250)) {
                Ok(envelope) => match envelope.kind {
                    CollectorEnvelopeKind::Event => {
                        if let Some(value) = envelope.event {
                            match serde_json::from_value::<TraceEventInput>(value) {
                                Ok(input) => {
                                    if let Ok(services) = services.lock() {
                                        let _ = services
                                            .collector_append_event(&drain_session_id, input);
                                    }
                                }
                                Err(_) => {
                                    if let Ok(mut values) = diagnostics.lock() {
                                        values.push(harnesscope_collector_sdk::CollectorDiagnostic {
                                            code: "COLLECTOR_PROTOCOL_ERROR".into(),
                                            message: "Collector event did not match the trace-event contract.".into(),
                                            data: None,
                                        });
                                    }
                                }
                            }
                        }
                    }
                    CollectorEnvelopeKind::Diagnostic => {
                        if let Some(diagnostic) = envelope.diagnostic {
                            if let Ok(mut values) = diagnostics.lock() {
                                values.push(diagnostic.clone());
                            }
                            let input = TraceEventInput {
                                id: None,
                                timestamp_utc: None,
                                source: "collector-diagnostic".into(),
                                kind: "Unknown".into(),
                                correlation_id: Some(drain_instance_id.clone()),
                                data: json!({
                                    "collectorId": drain_collector_id.clone(),
                                    "instanceId": drain_instance_id.clone(),
                                    "code": diagnostic.code,
                                    "message": diagnostic.message,
                                    "data": diagnostic.data,
                                }),
                                redaction: None,
                            };
                            if let Ok(services) = services.lock() {
                                let _ = services.collector_append_event(&drain_session_id, input);
                            }
                        }
                    }
                    CollectorEnvelopeKind::Heartbeat => {}
                    CollectorEnvelopeKind::Completed => break,
                },
                Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                    if matches!(
                        drain_handle.status(),
                        CollectorStatus::Stopped | CollectorStatus::Failed
                    ) {
                        break;
                    }
                }
                Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    OperationEnvelope::success(collector_snapshot(&instance_id, &instance))
}

#[tauri::command(async)]
pub fn collector_stop(
    state: State<'_, DesktopState>,
    instance_id: String,
) -> OperationEnvelope<CollectorInstanceStatus> {
    let instance = match state.collector(&instance_id) {
        Ok(Some(instance)) => instance,
        Ok(None) => {
            return collector_failure("COLLECTOR_NOT_FOUND", "Collector instance was not found.");
        }
        Err(()) => {
            return collector_failure("COLLECTOR_STATE_FAILED", "Collector state is unavailable.");
        }
    };
    if instance.handle.stop(Duration::from_secs(2)).is_err() {
        return collector_failure(
            "COLLECTOR_STOP_TIMEOUT",
            "Collector did not stop within the allowed interval.",
        );
    }
    OperationEnvelope::success(collector_snapshot(&instance_id, &instance))
}

#[tauri::command]
pub fn collector_status(
    state: State<'_, DesktopState>,
    instance_id: String,
) -> OperationEnvelope<CollectorInstanceStatus> {
    match state.collector(&instance_id) {
        Ok(Some(instance)) => {
            OperationEnvelope::success(collector_snapshot(&instance_id, &instance))
        }
        Ok(None) => collector_failure("COLLECTOR_NOT_FOUND", "Collector instance was not found."),
        Err(()) => collector_failure("COLLECTOR_STATE_FAILED", "Collector state is unavailable."),
    }
}

#[tauri::command]
pub async fn dialog_pick_directory(
    app: AppHandle,
) -> Result<OperationEnvelope<Option<String>>, ()> {
    let picked = app.dialog().file().blocking_pick_folder();
    let value = match picked {
        None => None,
        Some(path) => match path.into_path() {
            Ok(path) => Some(path.to_string_lossy().into_owned()),
            Err(_) => return Ok(errors::dialog_failure()),
        },
    };
    Ok(OperationEnvelope::success(value))
}

#[tauri::command]
pub async fn dialog_pick_file(
    app: AppHandle,
    filters: Vec<DialogFilter>,
) -> Result<OperationEnvelope<Option<String>>, ()> {
    let mut dialog = app.dialog().file();
    for filter in filters {
        let extensions = filter
            .extensions
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        dialog = dialog.add_filter(filter.name, &extensions);
    }
    let value = match dialog.blocking_pick_file() {
        None => None,
        Some(path) => match path.into_path() {
            Ok(path) => Some(path.to_string_lossy().into_owned()),
            Err(_) => return Ok(errors::dialog_failure()),
        },
    };
    Ok(OperationEnvelope::success(value))
}
