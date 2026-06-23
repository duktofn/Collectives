use std::fs;
use std::path::{Path, PathBuf};
use crate::collection::model::Collection;
use tauri::AppHandle;
use tauri::Manager;

// Core filesystem operations (generic and testable)
pub fn save_collection_to_path(collections_dir: &Path, collection: &Collection) -> Result<(), String> {
    validate_collection_name_in_path(collections_dir, &collection.name, &collection.id)?;

    let file_path = collections_dir.join(format!("{}.json", collection.id));
    let tmp_path = collections_dir.join(format!("{}.json.tmp", collection.id));

    let json_data = serde_json::to_string_pretty(collection)
        .map_err(|e| format!("Failed to serialize collection: {}", e))?;

    fs::write(&tmp_path, json_data)
        .map_err(|e| format!("Failed to write temp collection file: {}", e))?;
    fs::rename(&tmp_path, &file_path)
        .map_err(|e| format!("Failed to rename temp collection file to final: {}", e))?;

    Ok(())
}

pub fn load_collection_from_path(collections_dir: &Path, id: &str) -> Result<Collection, String> {
    let file_path = collections_dir.join(format!("{}.json", id));
    let data = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read collection {}: {}", id, e))?;
    let collection: Collection = serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse collection {}: {}", id, e))?;
    Ok(collection)
}

pub fn delete_collection_from_path(collections_dir: &Path, id: &str) -> Result<(), String> {
    let file_path = collections_dir.join(format!("{}.json", id));
    if file_path.exists() {
        fs::remove_file(&file_path)
            .map_err(|e| format!("Failed to delete collection file {}: {}", id, e))?;
    }
    Ok(())
}

pub fn get_all_collections_from_path(collections_dir: &Path) -> Result<Vec<Collection>, String> {
    let mut collections = Vec::new();
    if !collections_dir.exists() {
        return Ok(collections);
    }
    let entries = fs::read_dir(collections_dir)
        .map_err(|e| format!("Failed to read collections directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();
        if path.is_file() && path.extension().map_or(false, |ext| ext == "json") {
            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if file_name != "settings.json" {
                let data = fs::read_to_string(&path)
                    .map_err(|e| format!("Failed to read collection file {:?}: {}", path, e))?;
                if let Ok(collection) = serde_json::from_str::<Collection>(&data) {
                    collections.push(collection);
                }
            }
        }
    }
    Ok(collections)
}

pub fn validate_collection_name_in_path(
    collections_dir: &Path,
    name: &str,
    exclude_id: &str,
) -> Result<(), String> {
    let collections = get_all_collections_from_path(collections_dir)?;
    let target_name_lower = name.to_lowercase();
    for col in collections {
        if col.id != exclude_id && col.name.to_lowercase() == target_name_lower {
            return Err(format!(
                "Collection name '{}' already exists (case-insensitive)",
                name
            ));
        }
    }
    Ok(())
}

// Tauri wrappers
pub fn get_collections_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let collections_dir = app_data.join(".collections");
    if !collections_dir.exists() {
        fs::create_dir_all(&collections_dir)
            .map_err(|e| format!("Failed to create collections directory: {}", e))?;
    }
    Ok(collections_dir)
}

pub fn save_collection(app: &AppHandle, collection: &Collection) -> Result<(), String> {
    let dir = get_collections_dir(app)?;
    save_collection_to_path(&dir, collection)
}

pub fn load_collection(app: &AppHandle, id: &str) -> Result<Collection, String> {
    let dir = get_collections_dir(app)?;
    load_collection_from_path(&dir, id)
}

pub fn delete_collection(app: &AppHandle, id: &str) -> Result<(), String> {
    let dir = get_collections_dir(app)?;
    delete_collection_from_path(&dir, id)
}

pub fn get_all_collections(app: &AppHandle) -> Result<Vec<Collection>, String> {
    let dir = get_collections_dir(app)?;
    get_all_collections_from_path(&dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collection::model::{Collection, Entry};

    #[test]
    fn test_collection_crud_and_uniqueness() {
        let temp_dir = tempfile::tempdir().unwrap();
        let dir_path = temp_dir.path();

        let col1 = Collection {
            id: "col1-id".to_string(),
            schema_version: 1,
            name: "My Collection".to_string(),
            created_at: "2026-06-24T00:00:00Z".to_string(),
            updated_at: "2026-06-24T00:00:00Z".to_string(),
            entries: vec![
                Entry::File {
                    id: "file1".to_string(),
                    path: "d:/test/note.md".to_string(),
                }
            ],
        };

        // Save
        save_collection_to_path(dir_path, &col1).unwrap();

        // Load
        let loaded = load_collection_from_path(dir_path, "col1-id").unwrap();
        assert_eq!(loaded.name, "My Collection");
        assert_eq!(loaded.entries.len(), 1);

        // Name uniqueness (same name -> fail)
        let col2 = Collection {
            id: "col2-id".to_string(),
            schema_version: 1,
            name: "my collection".to_string(),
            created_at: "2026-06-24T00:00:00Z".to_string(),
            updated_at: "2026-06-24T00:00:00Z".to_string(),
            entries: vec![],
        };
        let save_err = save_collection_to_path(dir_path, &col2);
        assert!(save_err.is_err());
        assert!(save_err.unwrap_err().contains("already exists"));

        // Save unique name -> pass
        let col3 = Collection {
            id: "col3-id".to_string(),
            schema_version: 1,
            name: "Other Collection".to_string(),
            created_at: "2026-06-24T00:00:00Z".to_string(),
            updated_at: "2026-06-24T00:00:00Z".to_string(),
            entries: vec![],
        };
        save_collection_to_path(dir_path, &col3).unwrap();

        // Get all
        let all = get_all_collections_from_path(dir_path).unwrap();
        assert_eq!(all.len(), 2);

        // Delete
        delete_collection_from_path(dir_path, "col1-id").unwrap();
        let loaded_err = load_collection_from_path(dir_path, "col1-id");
        assert!(loaded_err.is_err());
    }
}

