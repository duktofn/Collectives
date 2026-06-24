pub mod collection;
pub mod link_index;
pub mod settings;
pub mod commands;
pub mod fs_ops;
pub mod font_manager;
pub mod theme_io;
pub mod fs_layer;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let watch_manager = std::sync::Arc::new(std::sync::Mutex::new(fs_layer::watcher::WatchManager::new()));
            watch_manager.lock().unwrap().init(app.handle().clone())?;
            app.manage(fs_layer::watcher::WatchState(watch_manager));
            app.manage(fs_layer::file_identity::FileIdentityCache::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_collections,
            commands::create_collection,
            commands::update_collection,
            commands::delete_collection,
            commands::load_settings,
            commands::save_settings,
            commands::read_folder_children,
            commands::add_entry,
            commands::remove_entry,
            commands::move_entry,
            commands::create_group,
            commands::rename_group,
            commands::add_file_entries,
            commands::add_folder_ref,
            commands::validate_entries,
            commands::read_file,
            commands::write_file,
            commands::resolve_wikilink,
            commands::search_link_index,
            commands::import_folder,
            commands::export_collection_to_folder,
            commands::export_collection_to_zip,
            commands::check_zip_conflicts,
            commands::import_zip,
            commands::import_font,
            commands::delete_font,
            commands::get_fonts_dir,
            commands::export_theme,
            commands::import_theme,
            fs_layer::watcher::watch_entry,
            fs_layer::watcher::unwatch_entry,
            fs_layer::watcher::watch_folder,
            fs_layer::watcher::unwatch_folder,
            fs_layer::watcher::clear_watches,
            fs_layer::file_identity::initialize_identity_cache,
            fs_layer::file_identity::detect_moved_entry
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

