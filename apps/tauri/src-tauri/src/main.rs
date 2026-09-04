#[cfg(any(target_os = "windows", target_os = "macos"))]
mod commands;
#[cfg(any(target_os = "windows", target_os = "macos"))]
mod errors;
#[cfg(any(target_os = "windows", target_os = "macos"))]
mod state;

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn main() {
    use harnesscope_core::AppServices;
    use state::DesktopState;
    use tauri::Manager;

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?.join("HarnessScope");
            std::fs::create_dir_all(&data_dir)?;
            let services = AppServices::open(
                data_dir.join("workspace.sqlite"),
                "HarnessScope",
                env!("CARGO_PKG_VERSION"),
                "tauri",
            )?;
            app.manage(DesktopState::new(services));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::workspace_info,
            commands::session_list,
            commands::session_create,
            commands::timeline_get,
            commands::inference_run,
            commands::compare_run,
            commands::import_har,
            commands::import_procmon,
            commands::import_jsonl,
            commands::launch_run,
            commands::export_run,
            commands::collector_list,
            commands::collector_describe,
            commands::collector_start,
            commands::collector_stop,
            commands::collector_status,
            commands::dialog_pick_directory,
            commands::dialog_pick_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running HarnessScope Tauri");
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn main() {
    eprintln!("HarnessScope Tauri desktop is packaged for Windows and macOS.");
}
