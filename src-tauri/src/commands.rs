use crate::collection::{self, Collection, model::Entry};
use crate::link_index;
use crate::settings::{self, Settings};
use crate::fs_ops::{self, FsEntry};
use chrono::Utc;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrokenEntry {
    pub id: String,
    pub path: String,
    pub reason: String,
}

fn update_collection_index(app: &AppHandle, collection_id: &str) {
    if let Ok(col) = collection::load_collection(app, collection_id) {
        if let Ok(conn) = link_index::init_db(app) {
            let _ = link_index::update_index_for_collection(&conn, &col);
        }
    }
}

#[tauri::command]
pub fn get_collections(app: AppHandle) -> Result<Vec<Collection>, String> {
    collection::get_all_collections(&app)
}

#[tauri::command]
pub fn create_collection(app: AppHandle, name: String) -> Result<Collection, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let collection = Collection {
        id,
        schema_version: 1,
        name,
        created_at: now.clone(),
        updated_at: now,
        entries: Vec::new(),
        metadata: None,
    };

    collection::save_collection(&app, &collection)?;
    Ok(collection)
}

#[tauri::command]
pub fn update_collection(app: AppHandle, mut collection: Collection) -> Result<(), String> {
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    collection.updated_at = now;

    collection::save_collection(&app, &collection)?;

    let conn = link_index::init_db(&app)?;
    link_index::update_index_for_collection(&conn, &collection)?;

    Ok(())
}

#[tauri::command]
pub fn delete_collection(app: AppHandle, id: String) -> Result<(), String> {
    collection::delete_collection(&app, &id)?;

    let conn = link_index::init_db(&app)?;
    link_index::clear_collection_entries(&conn, &id)?;

    Ok(())
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Settings {
    settings::load_settings(&app)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    settings::save_settings(&app, settings)
}

#[tauri::command]
pub fn read_folder_children(path: String) -> Result<Vec<FsEntry>, String> {
    fs_ops::read_children(std::path::Path::new(&path))
}

#[tauri::command]
pub fn add_entry(
    app: AppHandle,
    collection_id: String,
    parent_path: Vec<usize>,
    entry: Entry,
) -> Result<(), String> {
    collection::add_entry_to_collection(&app, &collection_id, &parent_path, entry)?;
    update_collection_index(&app, &collection_id);
    Ok(())
}

#[tauri::command]
pub fn remove_entry(
    app: AppHandle,
    collection_id: String,
    entry_id: String,
) -> Result<Entry, String> {
    let removed = collection::remove_entry_from_collection(&app, &collection_id, &entry_id)?;
    update_collection_index(&app, &collection_id);
    Ok(removed)
}

#[tauri::command]
pub fn move_entry(
    app: AppHandle,
    collection_id: String,
    entry_id: String,
    new_parent_path: Vec<usize>,
    new_index: usize,
) -> Result<(), String> {
    collection::move_entry_in_collection(&app, &collection_id, &entry_id, &new_parent_path, new_index)?;
    update_collection_index(&app, &collection_id);
    Ok(())
}

#[tauri::command]
pub fn create_group(
    app: AppHandle,
    collection_id: String,
    name: String,
    parent_path: Vec<usize>,
) -> Result<Entry, String> {
    let entry = Entry::Group {
        id: Uuid::new_v4().to_string(),
        name,
        children: Vec::new(),
    };
    collection::add_entry_to_collection(&app, &collection_id, &parent_path, entry.clone())?;
    update_collection_index(&app, &collection_id);
    Ok(entry)
}

#[tauri::command]
pub fn rename_group(
    app: AppHandle,
    collection_id: String,
    group_id: String,
    new_name: String,
) -> Result<(), String> {
    let mut collection = collection::load_collection(&app, &collection_id)?;
    
    let mut found = false;
    fn rename_in_entries(entries: &mut [Entry], group_id: &str, new_name: &str) -> bool {
        for entry in entries {
            match entry {
                Entry::Group { id, name, children } => {
                    if id == group_id {
                        *name = new_name.to_string();
                        return true;
                    }
                    if rename_in_entries(children, group_id, new_name) {
                        return true;
                    }
                }
                _ => {}
            }
        }
        false
    }
    
    if rename_in_entries(&mut collection.entries, &group_id, &new_name) {
        found = true;
    }
    
    if !found {
        return Err(format!("Group with ID {} not found", group_id));
    }
    
    collection.updated_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    collection::save_collection(&app, &collection)?;
    Ok(())
}

#[tauri::command]
pub fn add_file_entries(
    app: AppHandle,
    collection_id: String,
    paths: Vec<String>,
) -> Result<Vec<Entry>, String> {
    let mut added_entries = Vec::new();
    for path in paths {
        let entry = Entry::File {
            id: Uuid::new_v4().to_string(),
            path: fs_ops::normalize_path(&path),
        };
        collection::add_entry_to_collection(&app, &collection_id, &[], entry.clone())?;
        added_entries.push(entry);
    }
    update_collection_index(&app, &collection_id);
    Ok(added_entries)
}

#[tauri::command]
pub fn add_folder_ref(
    app: AppHandle,
    collection_id: String,
    path: String,
) -> Result<Entry, String> {
    let entry = Entry::FolderRef {
        id: Uuid::new_v4().to_string(),
        path: fs_ops::normalize_path(&path),
    };
    collection::add_entry_to_collection(&app, &collection_id, &[], entry.clone())?;
    update_collection_index(&app, &collection_id);
    Ok(entry)
}

#[tauri::command]
pub async fn validate_entries(
    app: AppHandle,
    collection_id: String,
) -> Result<Vec<BrokenEntry>, String> {
    let mut collection = collection::load_collection(&app, &collection_id)?;
    let mut entries_to_check = Vec::new();
    
    fn collect_entries_recursive(entries: &[Entry], dest: &mut Vec<(String, String, bool)>) {
        for entry in entries {
            match entry {
                Entry::File { id, path } => {
                    dest.push((id.clone(), path.clone(), true));
                }
                Entry::FolderRef { id, path } => {
                    dest.push((id.clone(), path.clone(), false));
                }
                Entry::Group { children, .. } => {
                    collect_entries_recursive(children, dest);
                }
            }
        }
    }
    
    collect_entries_recursive(&collection.entries, &mut entries_to_check);
    
    let mut tasks = Vec::new();
    for (id, path, is_file) in entries_to_check {
        tasks.push(tokio::task::spawn_blocking(move || {
            let exists = std::path::Path::new(&path).exists();
            if !exists {
                Some(BrokenEntry {
                    id,
                    path,
                    reason: if is_file { "File not found".to_string() } else { "Folder not found".to_string() },
                })
            } else {
                None
            }
        }));
    }
    
    let mut broken = Vec::new();
    for task in tasks {
        if let Ok(Some(broken_entry)) = task.await {
            broken.push(broken_entry);
        }
    }
    
    let broken_ids: Vec<String> = broken.iter().map(|b| b.id.clone()).collect();
    let timestamp = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    
    collection.metadata = Some(collection::model::CollectionMetadata {
        last_validated_at: Some(timestamp),
        broken_entry_ids: broken_ids,
    });
    
    collection::save_collection(&app, &collection)?;
    
    Ok(broken)
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    let path = std::path::Path::new(&path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories: {}", e))?;
    }
    let id = uuid::Uuid::new_v4().to_string();
    let tmp_filename = format!(
        "{}.tmp-{}",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("file"),
        id
    );
    let tmp_path = path.with_file_name(tmp_filename);
    std::fs::write(&tmp_path, content)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;
    if let Err(e) = std::fs::rename(&tmp_path, path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!("Failed to save file: {}", e));
    }
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolveCandidate {
    pub display_name: String,
    pub entry_id: String,
    pub path: String,
    pub entry_type: String,
}

#[tauri::command]
pub fn resolve_wikilink(
    app: AppHandle,
    collection_id: String,
    note_name: String,
) -> Result<Option<ResolveCandidate>, String> {
    let conn = link_index::init_db(&app)?;
    let entry_opt = link_index::resolve_by_name(&conn, &collection_id, &note_name)?;
    Ok(entry_opt.map(|entry| ResolveCandidate {
        display_name: entry.display_name,
        entry_id: entry.entry_id,
        path: entry.path,
        entry_type: entry.entry_type,
    }))
}

#[tauri::command]
pub fn search_link_index(
    app: AppHandle,
    collection_id: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<ResolveCandidate>, String> {
    let conn = link_index::init_db(&app)?;
    let limit_val = limit.unwrap_or(20);
    let entries = link_index::search_by_name(&conn, &collection_id, &query, limit_val)?;
    Ok(entries
        .into_iter()
        .map(|entry| ResolveCandidate {
            display_name: entry.display_name,
            entry_id: entry.entry_id,
            path: entry.path,
            entry_type: entry.entry_type,
        })
        .collect())
}

#[tauri::command]
pub fn import_folder(
    app: AppHandle,
    path: String,
    name: String,
) -> Result<Collection, String> {
    let collections_dir = collection::get_collections_dir(&app)?;
    let folder_path = std::path::Path::new(&path);
    collection::archive::import_folder(&collections_dir, folder_path, &name)
}

#[tauri::command]
pub fn export_collection_to_folder(
    app: AppHandle,
    collection_id: String,
    dest_path: String,
) -> Result<(), String> {
    let collections_dir = collection::get_collections_dir(&app)?;
    let dest = std::path::Path::new(&dest_path);
    collection::archive::export_to_folder(&collections_dir, &collection_id, dest)
}

#[tauri::command]
pub fn export_collection_to_zip(
    app: AppHandle,
    collection_id: String,
    dest_zip_path: String,
) -> Result<(), String> {
    let collections_dir = collection::get_collections_dir(&app)?;
    let dest_zip = std::path::Path::new(&dest_zip_path);
    collection::archive::export_to_zip(&collections_dir, &collection_id, dest_zip)
}

#[tauri::command]
pub fn check_zip_conflicts(
    zip_path: String,
    dest_folder: String,
) -> Result<Vec<collection::archive::ZipConflict>, String> {
    let zip = std::path::Path::new(&zip_path);
    let dest = std::path::Path::new(&dest_folder);
    collection::archive::check_zip_conflicts(zip, dest)
}

#[tauri::command]
pub fn import_zip(
    app: AppHandle,
    zip_path: String,
    dest_folder: String,
    resolutions: std::collections::HashMap<String, String>,
) -> Result<Collection, String> {
    let collections_dir = collection::get_collections_dir(&app)?;
    let zip = std::path::Path::new(&zip_path);
    let dest = std::path::Path::new(&dest_folder);
    let col = collection::archive::import_zip(&collections_dir, zip, dest, resolutions)?;

    if let Ok(conn) = link_index::init_db(&app) {
        let _ = link_index::update_index_for_collection(&conn, &col);
    }

    Ok(col)
}

#[tauri::command]
pub fn import_font(
    app: AppHandle,
    source_path: String,
    family_name: String,
    weight: String,
    style: String,
) -> Result<crate::settings::CustomFont, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let src = std::path::Path::new(&source_path);
    crate::font_manager::import_font(&app_data, src, &family_name, &weight, &style)
}

#[tauri::command]
pub fn delete_font(app: AppHandle, file_name: String) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    crate::font_manager::delete_font(&app_data, &file_name)
}

#[tauri::command]
pub fn get_fonts_dir(app: AppHandle) -> Result<String, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let fonts_dir = crate::font_manager::get_fonts_dir(&app_data);
    Ok(fonts_dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn export_theme(
    app: AppHandle,
    settings: Settings,
    dest_path: String,
) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let dest = std::path::Path::new(&dest_path);
    crate::theme_io::export_theme(&app_data, &settings, dest)
}

#[tauri::command]
pub fn import_theme(
    app: AppHandle,
    theme_path: String,
) -> Result<Settings, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let src = std::path::Path::new(&theme_path);
    crate::theme_io::import_theme(&app_data, src)
}


