use crate::collection::model::{Collection, Entry};
use std::fs;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;

// Core filesystem operations (generic and testable)
pub fn save_collection_to_path(
    collections_dir: &Path,
    collection: &Collection,
) -> Result<(), String> {
    save_collection_to_path_impl(collections_dir, collection, true)
}

pub(crate) fn save_collection_to_path_during_transaction(
    collections_dir: &Path,
    collection: &Collection,
) -> Result<(), String> {
    save_collection_to_path_impl(collections_dir, collection, false)
}

fn save_collection_to_path_impl(
    collections_dir: &Path,
    collection: &Collection,
    recover_first: bool,
) -> Result<(), String> {
    if recover_first {
        crate::collection::import_transaction::recover(collections_dir)
            .map_err(|e| e.to_string())?;
    }
    validate_collection_name_in_path(collections_dir, &collection.name, &collection.id)?;

    let json_data = serde_json::to_string_pretty(collection)
        .map_err(|e| format!("Failed to serialize collection: {}", e))?;
    let file_path = collections_dir.join(format!("{}.json", collection.id));
    let mut journal = crate::collection::import_transaction::create_journal(
        collections_dir,
        &file_path,
        vec!["metadata-replace".to_string()],
        if file_path.exists() {
            Some(&file_path)
        } else {
            None
        },
    )
    .map_err(|e| e.to_string())?;
    let journal_root = crate::collection::import_transaction::transaction_root(collections_dir)
        .join(&journal.transaction_id);
    let staged_path = PathBuf::from(&journal.stage_root).join("metadata.json");
    fs::create_dir_all(Path::new(&journal.stage_root)).map_err(|e| format!("stage_failed: {e}"))?;
    let mut temp = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&staged_path)
        .map_err(|e| format!("Failed to open temp collection file: {}", e))?;
    use std::io::Write;
    temp.write_all(json_data.as_bytes())
        .map_err(|e| format!("Failed to write temp collection file: {}", e))?;
    temp.sync_all()
        .map_err(|e| format!("Failed to flush temp collection file: {}", e))?;
    drop(temp);
    crate::collection::import_transaction::transition(
        &journal_root,
        &mut journal,
        crate::collection::import_transaction::TransactionState::Staged,
    )
    .map_err(|e| e.to_string())?;
    let backup_path = journal_root.join("backup").join("metadata.json");
    let had_original = file_path.exists();
    let after_sha256 = crate::collection::import_transaction::path_digest(&staged_path)
        .map_err(|e| e.to_string())?;
    if had_original {
        let before_sha256 = crate::collection::import_transaction::path_digest(&file_path)
            .map_err(|e| e.to_string())?;
        fs::create_dir_all(backup_path.parent().unwrap())
            .map_err(|e| format!("recoverable_transaction: cannot create backup: {e}"))?;
        crate::collection::import_transaction::add_backup(
            &journal_root,
            &mut journal,
            &file_path,
            &backup_path,
            Some(before_sha256),
            Some(after_sha256.clone()),
        )
        .map_err(|e| e.to_string())?;
        crate::collection::import_transaction::transition(
            &journal_root,
            &mut journal,
            crate::collection::import_transaction::TransactionState::AssetsCommitting,
        )
        .map_err(|e| e.to_string())?;
        crate::collection::import_transaction::set_operation_status(
            &journal_root,
            &mut journal,
            "metadata-replace",
            "backup-started",
        )
        .map_err(|e| e.to_string())?;
        fs::rename(&file_path, &backup_path).map_err(|e| {
            format!(
                "recoverable_transaction: cannot preserve collection backup: {}",
                e
            )
        })?;
    } else {
        crate::collection::import_transaction::add_backup(
            &journal_root,
            &mut journal,
            &file_path,
            &backup_path,
            None,
            Some(after_sha256),
        )
        .map_err(|e| e.to_string())?;
    }
    crate::collection::import_transaction::set_operation_status(
        &journal_root,
        &mut journal,
        "metadata-replace",
        "backup-complete",
    )
    .map_err(|e| e.to_string())?;
    crate::collection::import_transaction::transition(
        &journal_root,
        &mut journal,
        crate::collection::import_transaction::TransactionState::MetadataCommitting,
    )
    .map_err(|e| e.to_string())?;
    if let Err(error) = fs::rename(&staged_path, &file_path) {
        return Err(format!(
            "recoverable_transaction: failed to publish collection: {}",
            error
        ));
    }
    crate::collection::import_transaction::set_operation_status(
        &journal_root,
        &mut journal,
        "metadata-replace",
        "published",
    )
    .map_err(|e| e.to_string())?;
    crate::collection::import_transaction::transition(
        &journal_root,
        &mut journal,
        crate::collection::import_transaction::TransactionState::Committed,
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn promote_group(entries: &mut Vec<Entry>, group_id: &str) -> bool {
    let mut index = 0;
    while index < entries.len() {
        if let Entry::Group { id, .. } = &entries[index] {
            if id == group_id {
                let removed = entries.remove(index);
                if let Entry::Group { children, .. } = removed {
                    for (offset, child) in children.into_iter().enumerate() {
                        entries.insert(index + offset, child);
                    }
                }
                return true;
            }
        }
        if let Entry::Group { children, .. } = &mut entries[index] {
            if promote_group(children, group_id) {
                return true;
            }
        }
        index += 1;
    }
    false
}

pub fn delete_group_and_promote_to_collection_path(
    collections_dir: &Path,
    collection_id: &str,
    group_id: &str,
) -> Result<(), String> {
    crate::collection::import_transaction::recover(collections_dir).map_err(|e| e.to_string())?;
    let mut collection = load_collection_from_path(collections_dir, collection_id)?;
    if !promote_group(&mut collection.entries, group_id) {
        return Err(format!("Group with ID {} not found", group_id));
    }
    collection.updated_at = chrono::Utc::now().to_rfc3339();
    save_collection_to_path(collections_dir, &collection)
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
        if path.is_file() && path.extension().is_some_and(|ext| ext == "json") {
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

fn get_group_mut<'a>(
    entries: &'a mut Vec<Entry>,
    path: &[usize],
) -> Result<&'a mut Vec<Entry>, String> {
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
            Entry::Group {
                id: entry_id,
                children,
                ..
            } => {
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
            entries: vec![Entry::File {
                id: "file1".to_string(),
                path: "d:/test/note.md".to_string(),
            }],
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
            entries: vec![Entry::Group {
                id: "group1".to_string(),
                name: "My Group".to_string(),
                children: vec![],
            }],
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
        let removed =
            remove_entry_from_collection_path(dir_path, "col-id", "file-in-group").unwrap();
        assert_eq!(removed, new_file);

        let loaded = load_collection_from_path(dir_path, "col-id").unwrap();
        if let Entry::Group { children, .. } = &loaded.entries[0] {
            assert_eq!(children.len(), 1);
            assert_eq!(children[0], root_file);
        } else {
            panic!("Expected first entry to be a Group");
        }
    }

    #[test]
    fn test_move_entry_forward_index_adjustment() {
        let temp_dir = tempfile::tempdir().unwrap();
        let dir_path = temp_dir.path();

        let col_id = "col-id-forward";
        let collection = Collection {
            id: col_id.to_string(),
            schema_version: 1,
            name: "Test Forward".to_string(),
            entries: vec![
                Entry::File {
                    id: "file-a".to_string(),
                    path: "d:/test/file-a.md".to_string(),
                },
                Entry::Group {
                    id: "group-b".to_string(),
                    name: "group-b".to_string(),
                    children: vec![],
                },
            ],
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            metadata: None,
        };
        save_collection_to_path(dir_path, &collection).unwrap();

        // Move file-a (index 0) into group-b (path [1]), target_idx 0.
        // This exercises old_path[i] < adjusted_parent_path[i] at line 233,
        // decrementing adjusted_parent_path from [1] to [0].
        move_entry_in_collection_path(dir_path, col_id, "file-a", &[1], 0).unwrap();

        let loaded = load_collection_from_path(dir_path, col_id).unwrap();
        assert_eq!(loaded.entries.len(), 1); // Only group-b left at root
        if let Entry::Group { id, children, .. } = &loaded.entries[0] {
            assert_eq!(id, "group-b");
            assert_eq!(children.len(), 1);
            if let Entry::File { id, .. } = &children[0] {
                assert_eq!(id, "file-a");
            } else {
                panic!("Expected child to be file-a");
            }
        } else {
            panic!("Expected first entry to be group-b");
        }

        // Sub-case 2: two root-level files + one group, move entries[0] into entries[2] (group)
        let col_id_2 = "col-id-forward-2";
        let collection_2 = Collection {
            id: col_id_2.to_string(),
            schema_version: 1,
            name: "Test Forward 2".to_string(),
            entries: vec![
                Entry::File {
                    id: "file-1".to_string(),
                    path: "d:/test/file-1.md".to_string(),
                },
                Entry::File {
                    id: "file-2".to_string(),
                    path: "d:/test/file-2.md".to_string(),
                },
                Entry::Group {
                    id: "group-3".to_string(),
                    name: "group-3".to_string(),
                    children: vec![],
                },
            ],
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            metadata: None,
        };
        save_collection_to_path(dir_path, &collection_2).unwrap();

        // Move file-1 (index 0) into group-3 (path [2]), target_idx 0.
        // Decrements adjusted_parent_path from [2] to [1].
        move_entry_in_collection_path(dir_path, col_id_2, "file-1", &[2], 0).unwrap();

        let loaded = load_collection_from_path(dir_path, col_id_2).unwrap();
        assert_eq!(loaded.entries.len(), 2); // file-2 and group-3 left at root
        if let Entry::File { id, .. } = &loaded.entries[0] {
            assert_eq!(id, "file-2");
        } else {
            panic!("Expected first entry to be file-2");
        }

        if let Entry::Group { id, children, .. } = &loaded.entries[1] {
            assert_eq!(id, "group-3");
            assert_eq!(children.len(), 1);
            if let Entry::File { id, .. } = &children[0] {
                assert_eq!(id, "file-1");
            } else {
                panic!("Expected child to be file-1");
            }
        } else {
            panic!("Expected second entry to be group-3");
        }
    }
}
