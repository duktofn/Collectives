use std::fs;
use std::path::{Path, PathBuf};
use crate::collection::model::{Collection, Entry};
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

fn get_group_mut<'a>(entries: &'a mut Vec<Entry>, path: &[usize]) -> Result<&'a mut Vec<Entry>, String> {
    let mut current_entries = entries;
    for &idx in path {
        if idx >= current_entries.len() {
            return Err("Index out of bounds".to_string());
        }
        match &mut current_entries[idx] {
            Entry::Group { children, .. } => {
                current_entries = children;
            }
            _ => return Err("Path segment is not a Group".to_string()),
        }
    }
    Ok(current_entries)
}

fn remove_entry_by_id_recursive(entries: &mut Vec<Entry>, entry_id: &str) -> (Option<Entry>, bool) {
    for i in 0..entries.len() {
        let match_id = match &entries[i] {
            Entry::File { id, .. } => id == entry_id,
            Entry::FolderRef { id, .. } => id == entry_id,
            Entry::Group { id, .. } => id == entry_id,
        };
        if match_id {
            let removed = entries.remove(i);
            return (Some(removed), true);
        }
        if let Entry::Group { children, .. } = &mut entries[i] {
            let (removed, found) = remove_entry_by_id_recursive(children, entry_id);
            if found {
                return (removed, true);
            }
        }
    }
    (None, false)
}

pub fn add_entry_to_collection_path(
    collections_dir: &Path,
    collection_id: &str,
    parent_path: &[usize],
    entry: Entry,
) -> Result<(), String> {
    let mut collection = load_collection_from_path(collections_dir, collection_id)?;
    {
        let target_list = get_group_mut(&mut collection.entries, parent_path)?;
        target_list.push(entry);
    }
    collection.updated_at = chrono::Utc::now().to_rfc3339();
    save_collection_to_path(collections_dir, &collection)?;
    Ok(())
}

pub fn remove_entry_from_collection_path(
    collections_dir: &Path,
    collection_id: &str,
    entry_id: &str,
) -> Result<Entry, String> {
    let mut collection = load_collection_from_path(collections_dir, collection_id)?;
    let (removed_entry, found) = remove_entry_by_id_recursive(&mut collection.entries, entry_id);
    if !found {
        return Err(format!("Entry with ID {} not found", entry_id));
    }
    collection.updated_at = chrono::Utc::now().to_rfc3339();
    save_collection_to_path(collections_dir, &collection)?;
    Ok(removed_entry.unwrap())
}

fn find_entry_path(entries: &[Entry], target_id: &str) -> Option<Vec<usize>> {
    for (i, entry) in entries.iter().enumerate() {
        let entry_id = match entry {
            Entry::File { id, .. } => id,
            Entry::FolderRef { id, .. } => id,
            Entry::Group { id, .. } => id,
        };
        if entry_id == target_id {
            return Some(vec![i]);
        }
        if let Entry::Group { children, .. } = entry {
            if let Some(mut path) = find_entry_path(children, target_id) {
                path.insert(0, i);
                return Some(path);
            }
        }
    }
    None
}

pub fn move_entry_in_collection_path(
    collections_dir: &Path,
    collection_id: &str,
    entry_id: &str,
    new_parent_path: &[usize],
    new_index: usize,
) -> Result<(), String> {
    let mut collection = load_collection_from_path(collections_dir, collection_id)?;
    
    let old_path = find_entry_path(&collection.entries, entry_id)
        .ok_or_else(|| format!("Entry with ID {} not found", entry_id))?;
        
    let mut adjusted_parent_path = new_parent_path.to_vec();
    let mut adjusted_index = new_index;

    // Check if moving ancestor into descendant
    if adjusted_parent_path.starts_with(&old_path) {
        return Err("Cannot move a group into its own subgroup".to_string());
    }

    // Adjust path and index due to removal
    let common_len = old_path.len().min(adjusted_parent_path.len());
    let mut diverged = false;
    for i in 0..common_len {
        if old_path[i] != adjusted_parent_path[i] {
            if i == old_path.len() - 1 && old_path[i] < adjusted_parent_path[i] {
                adjusted_parent_path[i] -= 1;
            }
            diverged = true;
            break;
        }
    }

    if !diverged && old_path.len() - 1 == adjusted_parent_path.len() {
        let old_idx = old_path[old_path.len() - 1];
        if adjusted_index > old_idx {
            adjusted_index -= 1;
        }
    }

    let (removed_entry, found) = remove_entry_by_id_recursive(&mut collection.entries, entry_id);
    if !found {
        return Err(format!("Entry with ID {} not found", entry_id));
    }
    let entry = removed_entry.unwrap();
    let target_list = get_group_mut(&mut collection.entries, &adjusted_parent_path)?;
    let idx = std::cmp::min(adjusted_index, target_list.len());
    target_list.insert(idx, entry);
    collection.updated_at = chrono::Utc::now().to_rfc3339();
    save_collection_to_path(collections_dir, &collection)?;
    Ok(())
}

pub fn find_entry_by_id<'a>(entries: &'a [Entry], id: &str) -> Option<&'a Entry> {
    for entry in entries {
        match entry {
            Entry::File { id: entry_id, .. } => {
                if entry_id == id {
                    return Some(entry);
                }
            }
            Entry::FolderRef { id: entry_id, .. } => {
                if entry_id == id {
                    return Some(entry);
                }
            }
            Entry::Group { id: entry_id, children, .. } => {
                if entry_id == id {
                    return Some(entry);
                }
                if let Some(found) = find_entry_by_id(children, id) {
                    return Some(found);
                }
            }
        }
    }
    None
}

// AppHandle wrappers for commands
pub fn add_entry_to_collection(
    app: &AppHandle,
    collection_id: &str,
    parent_path: &[usize],
    entry: Entry,
) -> Result<(), String> {
    let dir = get_collections_dir(app)?;
    add_entry_to_collection_path(&dir, collection_id, parent_path, entry)
}

pub fn remove_entry_from_collection(
    app: &AppHandle,
    collection_id: &str,
    entry_id: &str,
) -> Result<Entry, String> {
    let dir = get_collections_dir(app)?;
    remove_entry_from_collection_path(&dir, collection_id, entry_id)
}

pub fn move_entry_in_collection(
    app: &AppHandle,
    collection_id: &str,
    entry_id: &str,
    new_parent_path: &[usize],
    new_index: usize,
) -> Result<(), String> {
    let dir = get_collections_dir(app)?;
    move_entry_in_collection_path(&dir, collection_id, entry_id, new_parent_path, new_index)
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
            metadata: None,
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
            metadata: None,
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
            metadata: None,
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

    #[test]
    fn test_entry_manipulation() {
        let temp_dir = tempfile::tempdir().unwrap();
        let dir_path = temp_dir.path();

        let col = Collection {
            id: "col-id".to_string(),
            schema_version: 1,
            name: "Test Collection".to_string(),
            created_at: "2026-06-24T00:00:00Z".to_string(),
            updated_at: "2026-06-24T00:00:00Z".to_string(),
            entries: vec![
                Entry::Group {
                    id: "group1".to_string(),
                    name: "My Group".to_string(),
                    children: vec![],
                }
            ],
            metadata: None,
        };

        save_collection_to_path(dir_path, &col).unwrap();

        // 1. Add entry to group (parent_path = [0])
        let new_file = Entry::File {
            id: "file-in-group".to_string(),
            path: "d:/test/in_group.md".to_string(),
        };
        add_entry_to_collection_path(dir_path, "col-id", &[0], new_file.clone()).unwrap();

        // Load and check
        let loaded = load_collection_from_path(dir_path, "col-id").unwrap();
        assert_eq!(loaded.entries.len(), 1);
        if let Entry::Group { children, .. } = &loaded.entries[0] {
            assert_eq!(children.len(), 1);
            assert_eq!(children[0], new_file);
        } else {
            panic!("Expected first entry to be a Group");
        }

        // 2. Add entry to root (parent_path = [])
        let root_file = Entry::File {
            id: "file-at-root".to_string(),
            path: "d:/test/root.md".to_string(),
        };
        add_entry_to_collection_path(dir_path, "col-id", &[], root_file.clone()).unwrap();

        let loaded = load_collection_from_path(dir_path, "col-id").unwrap();
        assert_eq!(loaded.entries.len(), 2);
        assert_eq!(loaded.entries[1], root_file);

        // 3. Find entry by ID
        let found = find_entry_by_id(&loaded.entries, "file-in-group");
        assert!(found.is_some());
        assert_eq!(
            found.unwrap(),
            &Entry::File {
                id: "file-in-group".to_string(),
                path: "d:/test/in_group.md".to_string()
            }
        );

        let not_found = find_entry_by_id(&loaded.entries, "nonexistent");
        assert!(not_found.is_none());

        // 4. Move entry: move root_file into group1 (parent_path = [0])
        move_entry_in_collection_path(dir_path, "col-id", "file-at-root", &[0], 0).unwrap();

        let loaded = load_collection_from_path(dir_path, "col-id").unwrap();
        assert_eq!(loaded.entries.len(), 1); // Only group1 left at root
        if let Entry::Group { children, .. } = &loaded.entries[0] {
            assert_eq!(children.len(), 2);
            assert_eq!(children[0], root_file); // Inserted at index 0
            assert_eq!(children[1], new_file);
        } else {
            panic!("Expected first entry to be a Group");
        }

        // 5. Remove entry by ID
        let removed = remove_entry_from_collection_path(dir_path, "col-id", "file-in-group").unwrap();
        assert_eq!(removed, new_file);

        let loaded = load_collection_from_path(dir_path, "col-id").unwrap();
        if let Entry::Group { children, .. } = &loaded.entries[0] {
            assert_eq!(children.len(), 1);
            assert_eq!(children[0], root_file);
        } else {
            panic!("Expected first entry to be a Group");
        }
    }
}


