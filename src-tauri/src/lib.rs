pub mod application;
pub mod collection;
pub mod commands;
pub mod file_capabilities_generated;
pub mod font_manager;
pub mod fs_layer;
pub mod fs_ops;
pub mod ipc;
pub mod link_index;
pub mod metadata;
pub mod repositories;
pub mod safety_error;
pub mod settings;
pub mod theme_io;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let collections_dir =
                collection::manager::get_collections_dir(app.handle()).map_err(|error| {
                    Box::new(safety_error::SafetyError::from(error)) as Box<dyn std::error::Error>
                })?;
            collection::import_transaction::recover(&collections_dir)
                .map_err(|error| Box::new(error) as Box<dyn std::error::Error>)?;
            let services =
                application::services::AppServices::from_app(app.handle()).map_err(|error| {
                    Box::new(crate::safety_error::SafetyError::from(error))
                        as Box<dyn std::error::Error>
                })?;
            app.manage(services);
            let watch_manager =
                std::sync::Arc::new(std::sync::Mutex::new(fs_layer::watcher::WatchManager::new()));
            watch_manager.lock().unwrap().init(app.handle().clone())?;
            app.manage(fs_layer::watcher::WatchState(watch_manager));
            app.manage(fs_layer::file_identity::FileIdentityCache::new());
            Ok(())
        })
        .invoke_handler(crate::generated_ipc_handler!())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
