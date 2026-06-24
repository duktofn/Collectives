use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::collections::HashMap;
use std::io::{Read, Write};
use crate::collection::model::{Collection, Entry};
use crate::collection::manager;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};
use uuid::Uuid;
use chrono::Utc;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipConflict {
    pub entry_id: String,
    pub display_name: String,
    pub target_path: String,
}

fn get_non_conflicting_path(base_path: &Path) -> PathBuf {
    if !base_path.exists() {
        return base_path.to_path_buf();
    }

    let parent = base_path.parent().unwrap_or_else(|| Path::new(""));
    let file_stem = base_path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let extension = base_path.extension().and_then(|e| e.to_str()).unwrap_or("");

    let mut counter = 1;
    loop {
        let new_name = if extension.is_empty() {
            format!("{} ({})", file_stem, counter)
        } else {
            format!("{} ({}).{}", file_stem, counter, extension)
        };
        let candidate = parent.join(new_name);
        if !candidate.exists() {
            return candidate;
        }
        counter += 1;
    }
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst)
        .map_err(|e| format!("Failed to create directory {:?}: {}", dst, e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("Failed to read directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        let dest_child = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_all(&path, &dest_child)?;
        } else {
            fs::copy(&path, &dest_child)
                .map_err(|e| format!("Failed to copy file {:?}: {}", path, e))?;
        }
    }
    Ok(())
}

pub fn import_folder(collections_dir: &Path, folder_path: &Path, name: &str) -> Result<Collection, String> {
    if !folder_path.exists() {
        return Err(format!("Folder path does not exist: {:?}", folder_path));
    }
    if !folder_path.is_dir() {
        return Err(format!("Path is not a directory: {:?}", folder_path));
    }

    manager::validate_collection_name_in_path(collections_dir, name, "")?;

    let entries_dir = fs::read_dir(folder_path)
        .map_err(|e| format!("Failed to read folder: {}", e))?;

    let mut entries = Vec::new();
    for entry in entries_dir {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        let id = Uuid::new_v4().to_string();
        let path_str = path.to_string_lossy().to_string().replace('\\', "/");

        if path.is_file() {
            entries.push(Entry::File { id, path: path_str });
        } else if path.is_dir() {
            entries.push(Entry::FolderRef { id, path: path_str });
        }
    }

    entries.sort_by(|a, b| {
        let (a_is_dir, a_path) = match a {
            Entry::FolderRef { path, .. } => (true, path),
            Entry::File { path, .. } => (false, path),
            _ => (false, &"".to_string()),
        };
        let (b_is_dir, b_path) = match b {
            Entry::FolderRef { path, .. } => (true, path),
            Entry::File { path, .. } => (false, path),
            _ => (false, &"".to_string()),
        };

        if a_is_dir != b_is_dir {
            b_is_dir.cmp(&a_is_dir)
        } else {
            a_path.to_lowercase().cmp(&b_path.to_lowercase())
        }
    });

    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let collection = Collection {
        id: Uuid::new_v4().to_string(),
        schema_version: 1,
        name: name.to_string(),
        created_at: now.clone(),
        updated_at: now,
        entries,
        metadata: None,
    };

    manager::save_collection_to_path(collections_dir, &collection)?;
    Ok(collection)
}

pub fn export_to_folder(
    collections_dir: &Path,
    collection_id: &str,
    dest_path: &Path,
) -> Result<(), String> {
    let collection = manager::load_collection_from_path(collections_dir, collection_id)?;
    fs::create_dir_all(dest_path)
        .map_err(|e| format!("Failed to create destination directory: {}", e))?;

    export_entries_to_folder(&collection.entries, dest_path)?;
    Ok(())
}

fn export_entries_to_folder(entries: &[Entry], current_dest: &Path) -> Result<(), String> {
    for entry in entries {
        match entry {
            Entry::File { path, .. } => {
                let src_file = Path::new(path);
                if src_file.exists() {
                    let file_name = src_file.file_name().ok_or("Invalid file name")?;
                    let target_path = current_dest.join(file_name);
                    let final_path = get_non_conflicting_path(&target_path);
                    fs::copy(src_file, &final_path)
                        .map_err(|e| format!("Failed to copy file {:?} to {:?}: {}", src_file, final_path, e))?;
                }
            }
            Entry::FolderRef { path, .. } => {
                let src_dir = Path::new(path);
                if src_dir.exists() {
                    let dir_name = src_dir.file_name().ok_or("Invalid directory name")?;
                    let target_path = current_dest.join(dir_name);
                    let final_path = get_non_conflicting_path(&target_path);
                    copy_dir_all(src_dir, &final_path)?;
                }
            }
            Entry::Group { name, children, .. } => {
                let target_path = current_dest.join(name);
                let final_path = get_non_conflicting_path(&target_path);
                fs::create_dir_all(&final_path)
                    .map_err(|e| format!("Failed to create group directory: {}", e))?;
                export_entries_to_folder(children, &final_path)?;
            }
        }
    }
    Ok(())
}

fn map_entries_for_zip(entries: &[Entry]) -> Vec<Entry> {
    entries
        .iter()
        .map(|entry| match entry {
            Entry::File { id, path } => {
                let src_path = Path::new(path);
                let file_name = src_path.file_name().and_then(|n| n.to_str()).unwrap_or("file.md");
                Entry::File {
                    id: id.clone(),
                    path: format!("assets/{}", file_name),
                }
            }
            Entry::FolderRef { id, path } => {
                let src_path = Path::new(path);
                let dir_name = src_path.file_name().and_then(|n| n.to_str()).unwrap_or("folder");
                Entry::FolderRef {
                    id: id.clone(),
                    path: format!("assets/{}", dir_name),
                }
            }
            Entry::Group { id, name, children } => {
                Entry::Group {
                    id: id.clone(),
                    name: name.clone(),
                    children: map_entries_for_zip(children),
                }
            }
        })
        .collect()
}

pub fn export_to_zip(
    collections_dir: &Path,
    collection_id: &str,
    dest_zip_path: &Path,
) -> Result<(), String> {
    let collection = manager::load_collection_from_path(collections_dir, collection_id)?;

    let file = File::create(dest_zip_path)
        .map_err(|e| format!("Failed to create ZIP file: {}", e))?;
    let mut zip = ZipWriter::new(file);

    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o755);

    zip.add_directory("assets/", options)
        .map_err(|e| format!("Failed to add assets directory to ZIP: {}", e))?;

    export_entries_to_zip(&collection.entries, &mut zip, options)?;

    let mapped_entries = map_entries_for_zip(&collection.entries);
    let mapped_collection = Collection {
        id: collection.id.clone(),
        schema_version: collection.schema_version,
        name: collection.name.clone(),
        created_at: collection.created_at.clone(),
        updated_at: collection.updated_at.clone(),
        entries: mapped_entries,
        metadata: None,
    };

    let manifest_json = serde_json::to_string_pretty(&mapped_collection)
        .map_err(|e| format!("Failed to serialize manifest: {}", e))?;

    zip.start_file("manifest.json", options)
        .map_err(|e| format!("Failed to create manifest.json in ZIP: {}", e))?;
    zip.write_all(manifest_json.as_bytes())
        .map_err(|e| format!("Failed to write manifest.json to ZIP: {}", e))?;

    zip.finish()
        .map_err(|e| format!("Failed to finish ZIP writing: {}", e))?;

    Ok(())
}

fn export_entries_to_zip<W: Write + std::io::Seek>(
    entries: &[Entry],
    zip: &mut ZipWriter<W>,
    options: SimpleFileOptions,
) -> Result<(), String> {
    for entry in entries {
        match entry {
            Entry::File { id, path } => {
                let src_path = Path::new(path);
                if src_path.exists() {
                    let ext = src_path.extension().and_then(|e| e.to_str()).unwrap_or("md");
                    let zip_file_name = format!("assets/{}.{}", id, ext);
                    zip.start_file(zip_file_name.clone(), options)
                        .map_err(|e| format!("Failed to start ZIP file {}: {}", zip_file_name, e))?;
                    let content = fs::read(src_path)
                        .map_err(|e| format!("Failed to read file {:?}: {}", src_path, e))?;
                    zip.write_all(&content)
                        .map_err(|e| format!("Failed to write file to ZIP: {}", e))?;
                }
            }
            Entry::FolderRef { id, path } => {
                let src_dir = Path::new(path);
                if src_dir.exists() && src_dir.is_dir() {
                    let zip_dir_name = format!("assets/{}/", id);
                    zip.add_directory(&zip_dir_name, options)
                        .map_err(|e| format!("Failed to add ZIP directory {}: {}", zip_dir_name, e))?;
                    add_dir_to_zip(zip, src_dir, &zip_dir_name, options)?;
                }
            }
            Entry::Group { children, .. } => {
                export_entries_to_zip(children, zip, options)?;
            }
        }
    }
    Ok(())
}

fn add_dir_to_zip<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    src_dir: &Path,
    zip_prefix: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    for entry in fs::read_dir(src_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let zip_path = format!("{}{}", zip_prefix, name);

        if path.is_dir() {
            zip.add_directory(format!("{}/", zip_path), options).map_err(|e| e.to_string())?;
            add_dir_to_zip(zip, &path, &format!("{}/", zip_path), options)?;
        } else {
            zip.start_file(zip_path.clone(), options).map_err(|e| e.to_string())?;
            let content = fs::read(&path).map_err(|e| e.to_string())?;
            zip.write_all(&content).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn check_zip_conflicts(
    zip_path: &Path,
    dest_folder: &Path,
) -> Result<Vec<ZipConflict>, String> {
    let file = File::open(zip_path)
        .map_err(|e| format!("Failed to open ZIP file: {}", e))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("Failed to read ZIP archive: {}", e))?;

    let mut manifest_file = archive.by_name("manifest.json")
        .map_err(|e| format!("manifest.json not found in ZIP: {}", e))?;
    let mut manifest_content = String::new();
    manifest_file.read_to_string(&mut manifest_content)
        .map_err(|e| format!("Failed to read manifest.json from ZIP: {}", e))?;

    let collection: Collection = serde_json::from_str(&manifest_content)
        .map_err(|e| format!("Failed to parse manifest.json: {}", e))?;

    let mut conflicts = Vec::new();
    check_entries_conflicts(&collection.entries, dest_folder, &mut conflicts);

    Ok(conflicts)
}

fn check_entries_conflicts(
    entries: &[Entry],
    dest_folder: &Path,
    conflicts: &mut Vec<ZipConflict>,
) {
    for entry in entries {
        match entry {
            Entry::File { id, path } => {
                let relative_path = path.strip_prefix("assets/").unwrap_or(path);
                let target_path = dest_folder.join(relative_path);
                if target_path.exists() {
                    let display_name = Path::new(relative_path)
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or(relative_path)
                        .to_string();
                    conflicts.push(ZipConflict {
                        entry_id: id.clone(),
                        display_name,
                        target_path: target_path.to_string_lossy().to_string().replace('\\', "/"),
                    });
                }
            }
            Entry::FolderRef { id, path } => {
                let relative_path = path.strip_prefix("assets/").unwrap_or(path);
                let target_path = dest_folder.join(relative_path);
                if target_path.exists() {
                    let display_name = Path::new(relative_path)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(relative_path)
                        .to_string();
                    conflicts.push(ZipConflict {
                        entry_id: id.clone(),
                        display_name,
                        target_path: target_path.to_string_lossy().to_string().replace('\\', "/"),
                    });
                }
            }
            Entry::Group { children, .. } => {
                check_entries_conflicts(children, dest_folder, conflicts);
            }
        }
    }
}

pub fn import_zip(
    collections_dir: &Path,
    zip_path: &Path,
    dest_folder: &Path,
    resolutions: HashMap<String, String>,
) -> Result<Collection, String> {
    let file = File::open(zip_path)
        .map_err(|e| format!("Failed to open ZIP file: {}", e))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("Failed to read ZIP archive: {}", e))?;

    let mut manifest_content = String::new();
    {
        let mut manifest_file = archive.by_name("manifest.json")
            .map_err(|e| format!("manifest.json not found in ZIP: {}", e))?;
        manifest_file.read_to_string(&mut manifest_content)
            .map_err(|e| format!("Failed to read manifest.json from ZIP: {}", e))?;
    }

    let collection: Collection = serde_json::from_str(&manifest_content)
        .map_err(|e| format!("Failed to parse manifest.json: {}", e))?;

    if collection.schema_version > 1 {
        return Err(format!(
            "Unsupported schema version: {}. Please upgrade your application.",
            collection.schema_version
        ));
    }

    fs::create_dir_all(dest_folder)
        .map_err(|e| format!("Failed to create extract destination: {}", e))?;

    let mut updated_entries = collection.entries.clone();
    extract_zip_assets(
        &mut archive,
        &mut updated_entries,
        dest_folder,
        &resolutions,
    )?;

    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let new_collection_id = Uuid::new_v4().to_string();
    let new_collection = Collection {
        id: new_collection_id,
        schema_version: collection.schema_version,
        name: collection.name.clone(),
        created_at: now.clone(),
        updated_at: now,
        entries: updated_entries,
        metadata: None,
    };

    manager::save_collection_to_path(collections_dir, &new_collection)?;
    Ok(new_collection)
}

fn extract_zip_assets<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    entries: &mut [Entry],
    dest_folder: &Path,
    resolutions: &HashMap<String, String>,
) -> Result<(), String> {
    for entry in entries {
        match entry {
            Entry::File { id, path } => {
                let relative_path = path.strip_prefix("assets/").unwrap_or(path);
                let target_path = dest_folder.join(relative_path);

                let resolution = resolutions.get(id).map(|s| s.as_str()).unwrap_or("overwrite");
                if resolution == "skip" {
                    *path = target_path.to_string_lossy().to_string().replace('\\', "/");
                    continue;
                }

                let final_path = if resolution == "rename" {
                    get_non_conflicting_path(&target_path)
                } else {
                    target_path
                };

                let ext = Path::new(relative_path).extension().and_then(|e| e.to_str()).unwrap_or("md");
                let zip_name = format!("assets/{}.{}", id, ext);

                if let Ok(mut zip_file) = archive.by_name(&zip_name) {
                    if let Some(parent) = final_path.parent() {
                        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    let mut file_content = Vec::new();
                    zip_file.read_to_end(&mut file_content)
                        .map_err(|e| format!("Failed to read file from ZIP: {}", e))?;
                    fs::write(&final_path, file_content)
                        .map_err(|e| format!("Failed to write extracted file: {}", e))?;
                }

                *path = final_path.to_string_lossy().to_string().replace('\\', "/");
            }
            Entry::FolderRef { id, path } => {
                let relative_path = path.strip_prefix("assets/").unwrap_or(path);
                let target_path = dest_folder.join(relative_path);

                let resolution = resolutions.get(id).map(|s| s.as_str()).unwrap_or("overwrite");
                if resolution == "skip" {
                    *path = target_path.to_string_lossy().to_string().replace('\\', "/");
                    continue;
                }

                let final_path = if resolution == "rename" {
                    get_non_conflicting_path(&target_path)
                } else {
                    target_path
                };

                let zip_prefix = format!("assets/{}/", id);
                let archive_len = archive.len();
                for i in 0..archive_len {
                    let mut zip_file = archive.by_index(i)
                        .map_err(|e| format!("Failed to get ZIP file index {}: {}", i, e))?;
                    let zip_file_name = zip_file.name().to_string();
                    if zip_file_name.starts_with(&zip_prefix) {
                        let relative_file_path = zip_file_name.strip_prefix(&zip_prefix).unwrap();
                        let target_file_path = final_path.join(relative_file_path);

                        if zip_file_name.ends_with('/') {
                            fs::create_dir_all(&target_file_path).map_err(|e| e.to_string())?;
                        } else {
                            if let Some(parent) = target_file_path.parent() {
                                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                            }
                            let mut file_content = Vec::new();
                            zip_file.read_to_end(&mut file_content)
                                .map_err(|e| format!("Failed to read file from ZIP: {}", e))?;
                            fs::write(&target_file_path, file_content)
                                .map_err(|e| format!("Failed to write extracted file: {}", e))?;
                        }
                    }
                }

                *path = final_path.to_string_lossy().to_string().replace('\\', "/");
            }
            Entry::Group { children, .. } => {
                extract_zip_assets(archive, children, dest_folder, resolutions)?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_import_folder() {
        let temp_dir = tempfile::tempdir().unwrap();
        let folder_path = temp_dir.path().join("my_vault");
        fs::create_dir(&folder_path).unwrap();

        let file1 = folder_path.join("note1.md");
        fs::write(&file1, "# Hello").unwrap();
        let subfolder = folder_path.join("assets");
        fs::create_dir(&subfolder).unwrap();

        let collections_dir = temp_dir.path().join(".collections");
        fs::create_dir(&collections_dir).unwrap();

        let col = import_folder(&collections_dir, &folder_path, "Vault").unwrap();
        assert_eq!(col.name, "Vault");
        assert_eq!(col.entries.len(), 2);

        match &col.entries[0] {
            Entry::FolderRef { path, .. } => {
                assert!(path.contains("assets"));
            }
            _ => panic!("Expected FolderRef first"),
        }
        match &col.entries[1] {
            Entry::File { path, .. } => {
                assert!(path.contains("note1.md"));
            }
            _ => panic!("Expected File second"),
        }
    }
}

