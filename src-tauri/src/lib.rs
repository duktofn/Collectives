pub mod collection;
pub mod link_index;
pub mod settings;
pub mod commands;
pub mod fs_ops;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
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
            commands::validate_entries
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

