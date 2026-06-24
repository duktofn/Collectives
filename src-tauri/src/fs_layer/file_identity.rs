use std::collections::HashMap;
use std::sync::Mutex;
use std::path::{Path, PathBuf};
use file_id::{FileId, get_file_id};
use tauri::{AppHandle, State};

pub struct FileIdentityCache {
    cache: Mutex<HashMap<String, FileId>>,
}

impl FileIdentityCache {
    pub fn new() -> Self {
        Self {
            cache: Mutex::new(HashMap::new()),
        }
    }

    pub fn insert(&self, entry_id: String, path: &Path) {
        if let Ok(fid) = get_file_id(path) {
            self.cache.lock().unwrap().insert(entry_id, fid);
        }
    }

    pub fn get(&self, entry_id: &str) -> Option<FileId> {
        self.cache.lock().unwrap().get(entry_id).copied()
    }

    pub fn clear(&self) {
        self.cache.lock().unwrap().clear();
    }
}

pub fn scan_dir_for_id_recursive(dir: &Path, target_id: FileId, depth: usize) -> Option<PathBuf> {
    if depth == 0 || !dir.is_dir() {
        return None;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return None;
    };
    let mut subdirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() || path.is_dir() {
            if let Ok(fid) = get_file_id(&path) {
                if fid == target_id {
                    return Some(path);
                }
            }
        }
        if path.is_dir() {
            subdirs.push(path);
        }
    }
    for subdir in subdirs {
        if let Some(found) = scan_dir_for_id_recursive(&subdir, target_id, depth - 1) {
            return Some(found);
        }
    }
    None
}

#[tauri::command]
pub fn initialize_identity_cache(
    app: AppHandle,
    cache_state: State<'_, FileIdentityCache>,
    collection_id: String,
) -> Result<(), String> {
    cache_state.clear();
    let collection = crate::collection::load_collection(&app, &collection_id)?;

    fn cache_entries(entries: &[crate::collection::model::Entry], cache: &FileIdentityCache) {
        for entry in entries {
            match entry {
                crate::collection::model::Entry::File { id, path } => {
                    cache.insert(id.clone(), Path::new(path));
                }
                crate::collection::model::Entry::FolderRef { id, path } => {
                    cache.insert(id.clone(), Path::new(path));
                }
                crate::collection::model::Entry::Group { children, .. } => {
                    cache_entries(children, cache);
                }
            }
        }
    }

    cache_entries(&collection.entries, &cache_state);
    Ok(())
}

#[tauri::command]
pub fn detect_moved_entry(
    app: AppHandle,
    cache_state: State<'_, FileIdentityCache>,
    collection_id: String,
    entry_id: String,
    old_path: String,
) -> Result<Option<String>, String> {
    let Some(target_id) = cache_state.get(&entry_id) else {
        return Ok(None);
    };

    let collection = crate::collection::load_collection(&app, &collection_id)?;
    let mut candidate_folders = std::collections::HashSet::new();

    if let Some(parent) = Path::new(&old_path).parent() {
        if parent.exists() {
            candidate_folders.insert(parent.to_path_buf());
        }
    }

    fn collect_candidates(entries: &[crate::collection::model::Entry], folders: &mut std::collections::HashSet<PathBuf>) {
        for entry in entries {
            match entry {
                crate::collection::model::Entry::File { path, .. } => {
                    if let Some(parent) = Path::new(path).parent() {
                        if parent.exists() {
                            folders.insert(parent.to_path_buf());
                        }
                    }
                }
                crate::collection::model::Entry::FolderRef { path, .. } => {
                    if Path::new(path).exists() {
                        folders.insert(PathBuf::from(path));
                    }
                }
                crate::collection::model::Entry::Group { children, .. } => {
                    collect_candidates(children, folders);
                }
            }
        }
    }
    collect_candidates(&collection.entries, &mut candidate_folders);

    for folder in candidate_folders {
        if let Some(found_path) = scan_dir_for_id_recursive(&folder, target_id, 3) {
            return Ok(Some(crate::fs_ops::normalize_path(&found_path.to_string_lossy())));
        }
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;

    #[test]
    fn test_file_identity_and_scan() {
        let temp_dir = tempfile::tempdir().unwrap();
        let dir_path = temp_dir.path();

        let file_path = dir_path.join("test_ident.md");
        File::create(&file_path).unwrap();

        let fid = get_file_id(&file_path).unwrap();

        let found = scan_dir_for_id_recursive(dir_path, fid, 2).unwrap();
        assert_eq!(found.canonicalize().unwrap(), file_path.canonicalize().unwrap());
    }
}

