use crate::collection::{self, Collection, model::Entry};
use crate::link_index;
use crate::settings::{self, Settings};
use crate::fs_ops::{self, FsEntry};
use chrono::Utc;
use tauri::AppHandle;
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
            path,
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
        path,
    };
    collection::add_entry_to_collection(&app, &collection_id, &[], entry.clone())?;
    update_collection_index(&app, &collection_id);
    Ok(entry)
}

#[tauri::command]
pub fn validate_entries(
    app: AppHandle,
    collection_id: String,
) -> Result<Vec<BrokenEntry>, String> {
    let collection = collection::load_collection(&app, &collection_id)?;
    let mut broken = Vec::new();
    
    fn validate_entries_recursive(entries: &[Entry], broken: &mut Vec<BrokenEntry>) {
        for entry in entries {
            match entry {
                Entry::File { id, path } => {
                    if !std::path::Path::new(path).exists() {
                        broken.push(BrokenEntry {
                            id: id.clone(),
                            path: path.clone(),
                            reason: "File not found".to_string(),
                        });
                    }
                }
                Entry::FolderRef { id, path } => {
                    if !std::path::Path::new(path).exists() {
                        broken.push(BrokenEntry {
                            id: id.clone(),
                            path: path.clone(),
                            reason: "Folder not found".to_string(),
                        });
                    }
                }
                Entry::Group { children, .. } => {
                    validate_entries_recursive(children, broken);
                }
            }
        }
    }
    
    validate_entries_recursive(&collection.entries, &mut broken);
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

