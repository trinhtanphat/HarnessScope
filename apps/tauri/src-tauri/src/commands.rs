use crate::{errors, state::DesktopState};
use harnesscope_core::{
    AppInfo, CompareResult, ImportResult, InferenceResult, LaunchRequest, LaunchResult,
    OperationEnvelope, ServiceExportResult, Session, SessionSnapshot, WorkspaceInfo,
};
use serde::Deserialize;
use std::path::PathBuf;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

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

fn with_services<T>(
    state: &State<'_, DesktopState>,
    operation: impl FnOnce(&harnesscope_core::AppServices) -> Result<T, harnesscope_core::CoreError>,
) -> OperationEnvelope<T> {
    match state.with_services(operation) {
        Ok(result) => errors::from_core(result),
        Err(()) => errors::state_failure(),
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
    with_services(&state, |services| services.session_create(&input.name, &input.mode))
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
    with_services(&state, |services| services.compare_run(&session_a, &session_b))
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
    with_services(&state, |services| services.import_procmon(&session_id, &path))
}

#[tauri::command(async)]
pub fn import_jsonl(
    state: State<'_, DesktopState>,
    session_id: String,
    path: PathBuf,
    map_path: PathBuf,
) -> OperationEnvelope<ImportResult> {
    with_services(&state, |services| services.import_jsonl(&session_id, &path, &map_path))
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
    with_services(&state, |services| services.export_run(&session_id, &out_dir))
}

#[tauri::command]
pub async fn dialog_pick_directory(app: AppHandle) -> Result<OperationEnvelope<Option<String>>, ()> {
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
        let extensions = filter.extensions.iter().map(String::as_str).collect::<Vec<_>>();
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
