use crate::collection::manager;
use crate::collection::model::{Collection, Entry};
use chrono::Utc;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipConflict {
    pub conflict_id: String,
    pub entry_id: String,
    pub display_name: String,
    pub target_path: String,
    pub origin_members: Vec<String>,
    pub allowed_resolutions: Vec<String>,
    pub kind: String,
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
    let mut fault = None;
    copy_dir_all_with_fault(src, dst, &mut fault)
}

fn copy_dir_all_with_fault(
    src: &Path,
    dst: &Path,
    fault: &mut Option<usize>,
) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("Failed to create directory {:?}: {}", dst, e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("Failed to read directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        let dest_child = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_all_with_fault(&path, &dest_child, fault)?;
        } else {
            if let Some(remaining) = fault {
                if *remaining == 0 {
                    return Err("stage_failed: injected folder copy failure".to_string());
                }
                *remaining -= 1;
            }
            fs::copy(&path, &dest_child)
                .map_err(|e| format!("Failed to copy file {:?}: {}", path, e))?;
        }
    }
    Ok(())
}

fn prepare_cross_volume_publish(
    journal_root: &Path,
    journal: &mut crate::collection::import_transaction::TransactionJournal,
    source: &Path,
    payload_name: &str,
    directory: bool,
) -> Result<PathBuf, String> {
    let destination = Path::new(&journal.destination_root);
    let parent = destination
        .parent()
        .ok_or_else(|| "recoverable_transaction: destination has no parent".to_string())?;
    let publish_root = parent.join(format!(".collectives-stage-{}", journal.transaction_id));
    if publish_root.exists() {
        return Err(
            "recoverable_transaction: cross-volume publish stage already exists".to_string(),
        );
    }
    fs::create_dir_all(&publish_root)
        .map_err(|e| format!("recoverable_transaction: cannot create publish stage: {e}"))?;
    let marker = publish_root.join(".collectives-owner");
    fs::write(
        &marker,
        format!("collectives-phase1-v1\n{}\n", journal.transaction_id),
    )
    .map_err(|e| format!("recoverable_transaction: cannot write publish marker: {e}"))?;
    let payload = publish_root.join(payload_name);
    if directory {
        copy_dir_all(source, &payload)?;
    } else {
        fs::copy(source, &payload)
            .map_err(|e| format!("recoverable_transaction: cross-volume copy failed: {e}"))?;
    }
    sync_tree(&publish_root)?;
    journal.publish_stage_root = Some(publish_root.to_string_lossy().into_owned());
    crate::collection::import_transaction::persist(journal_root, journal)
        .map_err(|e| e.to_string())?;
    Ok(payload)
}

fn sync_tree(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            sync_tree(&entry.map_err(|e| e.to_string())?.path())?;
        }
        #[cfg(unix)]
        fs::File::open(path)
            .and_then(|file| file.sync_all())
            .map_err(|e| format!("recoverable_transaction: directory fsync failed: {e}"))?;
    } else {
        fs::OpenOptions::new()
            .read(true)
            .open(path)
            .and_then(|file| file.sync_all())
            .map_err(|e| format!("recoverable_transaction: file fsync failed: {e}"))?;
    }
    Ok(())
}

fn prepare_cross_volume_backup(
    journal_root: &Path,
    journal: &mut crate::collection::import_transaction::TransactionJournal,
    payload_name: &str,
) -> Result<PathBuf, String> {
    let destination = Path::new(&journal.destination_root);
    let parent = destination
        .parent()
        .ok_or_else(|| "recoverable_transaction: destination has no parent".to_string())?;
    let backup_root = parent.join(format!(".collectives-backup-{}", journal.transaction_id));
    if backup_root.exists() {
        return Err(
            "recoverable_transaction: cross-volume backup stage already exists".to_string(),
        );
    }
    fs::create_dir_all(&backup_root)
        .map_err(|e| format!("recoverable_transaction: cannot create backup stage: {e}"))?;
    let marker = backup_root.join(".collectives-owner");
    fs::write(
        &marker,
        format!("collectives-phase1-v1\n{}\n", journal.transaction_id),
    )
    .map_err(|e| format!("recoverable_transaction: cannot write backup marker: {e}"))?;
    sync_tree(&backup_root)?;
    journal.backup_stage_root = Some(backup_root.to_string_lossy().into_owned());
    crate::collection::import_transaction::persist(journal_root, journal)
        .map_err(|e| e.to_string())?;
    Ok(backup_root.join(payload_name))
}

pub fn import_folder(
    collections_dir: &Path,
    folder_path: &Path,
    name: &str,
) -> Result<Collection, String> {
    if !folder_path.exists() {
        return Err(format!("Folder path does not exist: {:?}", folder_path));
    }
    if !folder_path.is_dir() {
        return Err(format!("Path is not a directory: {:?}", folder_path));
    }

    manager::validate_collection_name_in_path(collections_dir, name, "")?;

    let entries_dir =
        fs::read_dir(folder_path).map_err(|e| format!("Failed to read folder: {}", e))?;

    let mut entries = Vec::new();
    for entry in entries_dir {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        let id = Uuid::new_v4().to_string();
        let path_str = crate::fs_ops::normalize_path(&path.to_string_lossy());

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
    crate::collection::import_transaction::recover(collections_dir).map_err(|e| e.to_string())?;
    let collection = manager::load_collection_from_path(collections_dir, collection_id)?;
    validate_export_entries(&collection.entries)?;
    if dest_path.exists() {
        return Err("duplicate_destination: export child target already exists".to_string());
    }
    let parent = dest_path
        .parent()
        .ok_or_else(|| "duplicate_destination: export destination has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("stage_failed: cannot create export parent: {e}"))?;
    let mut journal = crate::collection::import_transaction::create_journal(
        collections_dir,
        dest_path,
        vec!["folder-export".to_string()],
        None,
    )
    .map_err(|e| e.to_string())?;
    let journal_root = crate::collection::import_transaction::transaction_root(collections_dir)
        .join(&journal.transaction_id);
    let stage = PathBuf::from(&journal.stage_root);
    journal.state = crate::collection::import_transaction::TransactionState::Staged;
    crate::collection::import_transaction::persist(&journal_root, &journal)
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&stage)
        .map_err(|e| format!("stage_failed: cannot create export stage: {e}"))?;
    if let Err(error) = export_entries_to_folder(&collection.entries, &stage) {
        journal.state = crate::collection::import_transaction::TransactionState::RolledBack;
        let _ = crate::collection::import_transaction::persist(&journal_root, &journal);
        return Err(format!("stage_failed: {error}"));
    }
    let publish_source = if journal.cross_volume {
        prepare_cross_volume_publish(&journal_root, &mut journal, &stage, "payload", true)?
    } else {
        stage.clone()
    };
    let after_sha256 = crate::collection::import_transaction::path_digest(&publish_source)
        .map_err(|e| e.to_string())?;
    let backup_path = journal_root.join("backup").join("folder-output");
    crate::collection::import_transaction::add_backup(
        &journal_root,
        &mut journal,
        dest_path,
        &backup_path,
        None,
        Some(after_sha256),
    )
    .map_err(|e| e.to_string())?;
    crate::collection::import_transaction::set_operation_status(
        &journal_root,
        &mut journal,
        "folder-export",
        "backup-ready",
    )
    .map_err(|e| e.to_string())?;
    if let Err(error) = fs::rename(&publish_source, dest_path) {
        journal.state = crate::collection::import_transaction::TransactionState::RollbackPending;
        let _ = crate::collection::import_transaction::persist(&journal_root, &journal);
        return Err(format!(
            "recoverable_transaction: cannot publish folder export: {error}"
        ));
    }
    crate::collection::import_transaction::set_operation_status(
        &journal_root,
        &mut journal,
        "folder-export",
        "complete",
    )
    .map_err(|e| e.to_string())?;
    journal.state = crate::collection::import_transaction::TransactionState::Committed;
    crate::collection::import_transaction::persist(&journal_root, &journal)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn validate_export_entries(entries: &[Entry]) -> Result<(), String> {
    for entry in entries {
        match entry {
            Entry::File { path, .. } => {
                if !Path::new(path).is_file() {
                    return Err(format!("source_missing: {path}"));
                }
            }
            Entry::FolderRef { path, .. } => {
                if !Path::new(path).is_dir() {
                    return Err(format!("source_missing: {path}"));
                }
            }
            Entry::Group { children, .. } => validate_export_entries(children)?,
        }
    }
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
                    fs::copy(src_file, &final_path).map_err(|e| {
                        format!(
                            "Failed to copy file {:?} to {:?}: {}",
                            src_file, final_path, e
                        )
                    })?;
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
                let file_name = src_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("file.md");
                Entry::File {
                    id: id.clone(),
                    path: format!("assets/{}", file_name),
                }
            }
            Entry::FolderRef { id, path } => {
                let src_path = Path::new(path);
                let dir_name = src_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("folder");
                Entry::FolderRef {
                    id: id.clone(),
                    path: format!("assets/{}", dir_name),
                }
            }
            Entry::Group { id, name, children } => Entry::Group {
                id: id.clone(),
                name: name.clone(),
                children: map_entries_for_zip(children),
            },
        })
        .collect()
}

pub fn export_to_zip(
    collections_dir: &Path,
    collection_id: &str,
    dest_zip_path: &Path,
) -> Result<(), String> {
    crate::collection::import_transaction::recover(collections_dir).map_err(|e| e.to_string())?;
    let collection = manager::load_collection_from_path(collections_dir, collection_id)?;
    validate_export_entries(&collection.entries)?;
    if dest_zip_path.exists() {
        return Err("duplicate_destination: ZIP output already exists".to_string());
    }
    let parent = dest_zip_path
        .parent()
        .ok_or_else(|| "commit_failed: ZIP destination has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("stage_failed: cannot create ZIP parent: {e}"))?;
    let mut journal = crate::collection::import_transaction::create_journal(
        collections_dir,
        dest_zip_path,
        vec!["zip-export".to_string()],
        None,
    )
    .map_err(|e| e.to_string())?;
    let journal_root = crate::collection::import_transaction::transaction_root(collections_dir)
        .join(&journal.transaction_id);
    let stage_root = PathBuf::from(&journal.stage_root);
    fs::create_dir_all(&stage_root)
        .map_err(|e| format!("stage_failed: cannot create ZIP stage: {e}"))?;
    let staged_zip = stage_root.join("export.zip");
    journal.state = crate::collection::import_transaction::TransactionState::Staged;
    crate::collection::import_transaction::persist(&journal_root, &journal)
        .map_err(|e| e.to_string())?;

    let file = File::create(&staged_zip)
        .map_err(|e| format!("stage_failed: cannot create ZIP stage: {e}"))?;
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

    let publish_source = if journal.cross_volume {
        prepare_cross_volume_publish(
            &journal_root,
            &mut journal,
            &staged_zip,
            "payload.zip",
            false,
        )?
    } else {
        staged_zip.clone()
    };
    let after_sha256 = crate::collection::import_transaction::path_digest(&publish_source)
        .map_err(|e| e.to_string())?;
    let backup_path = journal_root.join("backup").join("zip-output");
    crate::collection::import_transaction::add_backup(
        &journal_root,
        &mut journal,
        dest_zip_path,
        &backup_path,
        None,
        Some(after_sha256),
    )
    .map_err(|e| e.to_string())?;
    journal.state = crate::collection::import_transaction::TransactionState::AssetsCommitting;
    crate::collection::import_transaction::persist(&journal_root, &journal)
        .map_err(|e| e.to_string())?;
    crate::collection::import_transaction::set_operation_status(
        &journal_root,
        &mut journal,
        "zip-export",
        "backup-ready",
    )
    .map_err(|e| e.to_string())?;
    if let Err(error) = fs::rename(&publish_source, dest_zip_path) {
        journal.state = crate::collection::import_transaction::TransactionState::RollbackPending;
        let _ = crate::collection::import_transaction::persist(&journal_root, &journal);
        return Err(format!(
            "recoverable_transaction: cannot publish ZIP output: {error}"
        ));
    }
    crate::collection::import_transaction::set_operation_status(
        &journal_root,
        &mut journal,
        "zip-export",
        "complete",
    )
    .map_err(|e| e.to_string())?;
    journal.state = crate::collection::import_transaction::TransactionState::Committed;
    crate::collection::import_transaction::persist(&journal_root, &journal)
        .map_err(|e| e.to_string())?;

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
                    let ext = src_path
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("md");
                    let zip_file_name = format!("assets/{}.{}", id, ext);
                    zip.start_file(zip_file_name.clone(), options)
                        .map_err(|e| {
                            format!("Failed to start ZIP file {}: {}", zip_file_name, e)
                        })?;
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
                    zip.add_directory(&zip_dir_name, options).map_err(|e| {
                        format!("Failed to add ZIP directory {}: {}", zip_dir_name, e)
                    })?;
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
            zip.add_directory(format!("{}/", zip_path), options)
                .map_err(|e| e.to_string())?;
            add_dir_to_zip(zip, &path, &format!("{}/", zip_path), options)?;
        } else {
            zip.start_file(zip_path.clone(), options)
                .map_err(|e| e.to_string())?;
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
    preflight_zip(zip_path, dest_folder)
}

const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_MEMBERS: usize = 10_000;
const MAX_MEMBER_BYTES: u64 = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;

fn validate_archive_member(raw: &[u8], name: &str) -> Result<String, String> {
    if raw.is_empty() || raw.contains(&0) {
        return Err("invalid_archive_member: empty or NUL member".to_string());
    }
    std::str::from_utf8(raw)
        .map_err(|_| "invalid_archive_member: member name is not valid UTF-8".to_string())?;
    let normalized = name.replace('\\', "/");
    if normalized.split('/').any(|part| part == "..") {
        return Err(format!("invalid_archive_member: traversal member {name}"));
    }
    if normalized.starts_with('/') || normalized.starts_with("//") || normalized.contains(':') {
        return Err(format!(
            "invalid_archive_member: absolute or drive member {name}"
        ));
    }
    let mut depth = 0i32;
    for part in normalized.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            depth -= 1;
            if depth < 0 {
                return Err(format!("invalid_archive_member: traversal member {name}"));
            }
        } else {
            depth += 1;
        }
    }
    if !normalized.starts_with("assets/") && normalized != "manifest.json" {
        return Err(format!(
            "invalid_archive_member: member outside manifest/assets namespace {name}"
        ));
    }
    Ok(normalized)
}

fn collect_manifest_entries(
    entries: &[Entry],
    ids: &mut std::collections::HashSet<String>,
    members: &mut Vec<(String, String, bool)>,
) -> Result<(), String> {
    for entry in entries {
        let (id, path, is_folder) = match entry {
            Entry::File { id, path } => (id, path, false),
            Entry::FolderRef { id, path } => (id, path, true),
            Entry::Group { id, children, .. } => {
                if id.is_empty() || !ids.insert(id.clone()) {
                    return Err("duplicate_archive_member: duplicate or empty entry ID".to_string());
                }
                collect_manifest_entries(children, ids, members)?;
                continue;
            }
        };
        if id.is_empty() || !ids.insert(id.clone()) {
            return Err("duplicate_archive_member: duplicate or empty entry ID".to_string());
        }
        validate_archive_member(path.as_bytes(), path)?;
        if !path.starts_with("assets/") || path.len() <= "assets/".len() {
            return Err("invalid_archive_member: manifest path is outside assets".to_string());
        }
        members.push((id.clone(), path.clone(), is_folder));
    }
    Ok(())
}

fn preflight_zip(zip_path: &Path, dest_folder: &Path) -> Result<Vec<ZipConflict>, String> {
    let file = File::open(zip_path)
        .map_err(|e| format!("invalid_archive_member: cannot open ZIP: {e}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("invalid_archive_member: invalid ZIP: {e}"))?;
    if archive.len() > MAX_MEMBERS {
        return Err("archive_quota: member count exceeds 10000".to_string());
    }
    let mut total = 0u64;
    let mut member_names = std::collections::HashMap::<String, Vec<String>>::new();
    let mut normalized_targets = std::collections::HashMap::<String, Vec<String>>::new();
    let mut manifest = None;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("invalid_archive_member: {e}"))?;
        let raw = entry.name_raw().to_vec();
        let name = entry.name().to_string();
        let normalized = validate_archive_member(&raw, &name)?;
        if let Some(mode) = entry.unix_mode() {
            let kind = mode & 0o170000;
            if kind != 0 && kind != 0o100000 && kind != 0o040000 {
                return Err(format!(
                    "invalid_archive_member: special or symlink member {name}"
                ));
            }
        }
        if entry.is_dir() {
            continue;
        }
        if entry.size() > MAX_MEMBER_BYTES {
            return Err("archive_quota: member exceeds 256 MiB".to_string());
        }
        total = total
            .checked_add(entry.size())
            .ok_or_else(|| "archive_quota: total overflow".to_string())?;
        if total > MAX_TOTAL_BYTES {
            return Err("archive_quota: total exceeds 1 GiB".to_string());
        }
        if normalized == "manifest.json" {
            if entry.size() > MAX_MANIFEST_BYTES {
                return Err("archive_quota: manifest exceeds 64 KiB".to_string());
            }
            let mut bytes = Vec::new();
            entry
                .read_to_end(&mut bytes)
                .map_err(|e| format!("invalid_archive_member: manifest read failed: {e}"))?;
            manifest = Some(bytes);
        } else {
            member_names
                .entry(normalized.clone())
                .or_default()
                .push(normalized.clone());
            let target = crate::fs_ops::normalize_path(
                &dest_folder
                    .join(normalized.strip_prefix("assets/").unwrap_or(&normalized))
                    .to_string_lossy(),
            );
            let target_key = if cfg!(windows) {
                target.to_lowercase()
            } else {
                target.clone()
            };
            normalized_targets
                .entry(target_key)
                .or_default()
                .push(normalized);
        }
    }
    let manifest_bytes =
        manifest.ok_or_else(|| "invalid_archive_member: manifest.json is missing".to_string())?;
    let collection: Collection = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| format!("invalid_archive_member: malformed manifest: {e}"))?;
    let mut ids = std::collections::HashSet::new();
    let mut manifest_members = Vec::new();
    collect_manifest_entries(&collection.entries, &mut ids, &mut manifest_members)?;
    for (id, path, is_folder) in &manifest_members {
        let mut mapped_members = std::collections::HashSet::new();
        for member in member_names.keys() {
            let manifest_match = if *is_folder {
                member == path || member.starts_with(&format!("{path}/"))
            } else {
                member == path
            };
            let id_match = if *is_folder {
                member.starts_with(&format!("assets/{id}/"))
            } else {
                member.starts_with(&format!("assets/{id}."))
            };
            if manifest_match || id_match {
                mapped_members.insert(member.clone());
            }
        }
        if mapped_members.is_empty() {
            return Err(format!(
                "invalid_archive_member: no asset mapping for manifest entry {id}"
            ));
        }
        if mapped_members.len() > 1 && !*is_folder {
            return Err(format!(
                "duplicate_archive_member: multiple assets map to manifest entry {id}"
            ));
        }
    }
    let mut conflicts = Vec::new();
    for (target, origins) in normalized_targets {
        if origins.len() > 1 {
            let conflict_id = blake3::hash(origins.join("\0").as_bytes())
                .to_hex()
                .to_string();
            conflicts.push(ZipConflict {
                conflict_id,
                entry_id: String::new(),
                display_name: origins[0].clone(),
                target_path: target,
                origin_members: origins,
                allowed_resolutions: vec!["rename".to_string(), "skip".to_string()],
                kind: "internal-collision".to_string(),
            });
        } else if Path::new(&target).exists() {
            let origin = origins[0].clone();
            let conflict_id = manifest_members
                .iter()
                .find(|(_, path, _)| origin == *path)
                .map(|(id, _, _)| id.clone())
                .unwrap_or_else(|| blake3::hash(origin.as_bytes()).to_hex().to_string());
            conflicts.push(ZipConflict {
                conflict_id: conflict_id.clone(),
                entry_id: conflict_id,
                display_name: origin.clone(),
                target_path: target,
                origin_members: vec![origin],
                allowed_resolutions: vec![
                    "overwrite".to_string(),
                    "rename".to_string(),
                    "skip".to_string(),
                ],
                kind: "destination-existing".to_string(),
            });
        }
    }
    Ok(conflicts)
}

fn validate_resolutions(
    conflicts: &[ZipConflict],
    resolutions: &HashMap<String, String>,
) -> Result<(), String> {
    let allowed: std::collections::HashMap<String, Vec<String>> = conflicts
        .iter()
        .map(|c| (c.conflict_id.clone(), c.allowed_resolutions.clone()))
        .collect();
    for key in resolutions.keys() {
        if !allowed.contains_key(key) {
            return Err(format!("unresolved_conflict: unknown resolution {key}"));
        }
    }
    for conflict in conflicts {
        let value = resolutions.get(&conflict.conflict_id).ok_or_else(|| {
            format!(
                "unresolved_conflict: missing resolution {}",
                conflict.conflict_id
            )
        })?;
        if !conflict
            .allowed_resolutions
            .iter()
            .any(|allowed_value| allowed_value == value)
        {
            return Err(format!(
                "unresolved_conflict: incompatible resolution {}",
                conflict.conflict_id
            ));
        }
    }
    Ok(())
}

pub fn import_zip(
    collections_dir: &Path,
    zip_path: &Path,
    dest_folder: &Path,
    resolutions: HashMap<String, String>,
) -> Result<Collection, String> {
    crate::collection::import_transaction::recover(collections_dir).map_err(|e| e.to_string())?;
    if let Some(parent) = dest_folder.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("stage_failed: cannot create import parent: {e}"))?;
    }
    let conflicts = preflight_zip(zip_path, dest_folder)?;
    validate_resolutions(&conflicts, &resolutions)?;
    let mut effective_resolutions = resolutions.clone();
    for conflict in &conflicts {
        if let Some(resolution) = resolutions.get(&conflict.conflict_id) {
            if !conflict.entry_id.is_empty() {
                effective_resolutions.insert(conflict.entry_id.clone(), resolution.clone());
            }
            for member in &conflict.origin_members {
                effective_resolutions.insert(member.clone(), resolution.clone());
            }
        }
    }
    let mut journal = crate::collection::import_transaction::create_journal(
        collections_dir,
        dest_folder,
        vec![
            "asset-extract".to_string(),
            "collection-metadata".to_string(),
        ],
        None,
    )
    .map_err(|e| e.to_string())?;
    let journal_root = crate::collection::import_transaction::transaction_root(collections_dir)
        .join(&journal.transaction_id);
    let stage_root = PathBuf::from(&journal.stage_root);
    let staged_destination = stage_root.join("import-destination");
    journal.state = crate::collection::import_transaction::TransactionState::Staged;
    crate::collection::import_transaction::persist(&journal_root, &journal)
        .map_err(|e| e.to_string())?;
    if dest_folder.exists() {
        copy_dir_all(dest_folder, &staged_destination)
            .map_err(|e| format!("stage_failed: cannot copy existing destination: {e}"))?;
    } else {
        fs::create_dir_all(&staged_destination)
            .map_err(|e| format!("stage_failed: cannot create staged destination: {e}"))?;
    }
    let file = File::open(zip_path).map_err(|e| format!("Failed to open ZIP file: {}", e))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("Failed to read ZIP archive: {}", e))?;

    let mut manifest_content = String::new();
    {
        let mut manifest_file = archive
            .by_name("manifest.json")
            .map_err(|e| format!("manifest.json not found in ZIP: {}", e))?;
        manifest_file
            .read_to_string(&mut manifest_content)
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

    journal.state = crate::collection::import_transaction::TransactionState::AssetsCommitting;
    crate::collection::import_transaction::persist(&journal_root, &journal)
        .map_err(|e| e.to_string())?;
    crate::collection::import_transaction::set_operation_status(
        &journal_root,
        &mut journal,
        "asset-extract",
        "started",
    )
    .map_err(|e| e.to_string())?;
    fs::create_dir_all(dest_folder.parent().unwrap_or_else(|| Path::new("."))).map_err(|e| {
        journal.state = crate::collection::import_transaction::TransactionState::RolledBack;
        let _ = crate::collection::import_transaction::persist(&journal_root, &journal);
        format!("stage_failed: Failed to create extract destination: {e}")
    })?;

    let mut updated_entries = collection.entries.clone();
    extract_zip_assets(
        &mut archive,
        &mut updated_entries,
        &staged_destination,
        &effective_resolutions,
    )
    .map_err(|error| {
        journal.state = crate::collection::import_transaction::TransactionState::RollbackPending;
        let _ = crate::collection::import_transaction::persist(&journal_root, &journal);
        format!("rollback_pending: {error}")
    })?;
    rebase_entry_paths(&mut updated_entries, &staged_destination, dest_folder)?;
    crate::collection::import_transaction::set_operation_status(
        &journal_root,
        &mut journal,
        "asset-extract",
        "complete",
    )
    .map_err(|e| e.to_string())?;

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

    let publish_source = if journal.cross_volume {
        prepare_cross_volume_publish(
            &journal_root,
            &mut journal,
            &staged_destination,
            "payload",
            true,
        )?
    } else {
        staged_destination.clone()
    };
    let after_sha256 = crate::collection::import_transaction::path_digest(&publish_source)
        .map_err(|e| e.to_string())?;
    let backup_path = if journal.cross_volume && dest_folder.exists() {
        prepare_cross_volume_backup(&journal_root, &mut journal, "payload")?
    } else {
        journal_root.join("backup").join("import-destination")
    };
    if dest_folder.exists() {
        let before_sha256 = crate::collection::import_transaction::path_digest(dest_folder)
            .map_err(|e| e.to_string())?;
        crate::collection::import_transaction::add_backup(
            &journal_root,
            &mut journal,
            dest_folder,
            &backup_path,
            Some(before_sha256),
            Some(after_sha256),
        )
        .map_err(|e| e.to_string())?;
    } else {
        crate::collection::import_transaction::add_backup(
            &journal_root,
            &mut journal,
            dest_folder,
            &backup_path,
            None,
            Some(after_sha256),
        )
        .map_err(|e| e.to_string())?;
    }

    journal.state = crate::collection::import_transaction::TransactionState::AssetsCommitting;
    crate::collection::import_transaction::persist(&journal_root, &journal)
        .map_err(|e| e.to_string())?;
    crate::collection::import_transaction::set_operation_status(
        &journal_root,
        &mut journal,
        "asset-extract",
        "backup-ready",
    )
    .map_err(|e| e.to_string())?;
    if dest_folder.exists() {
        fs::create_dir_all(backup_path.parent().unwrap())
            .map_err(|e| format!("recoverable_transaction: cannot create import backup: {e}"))?;
        fs::rename(dest_folder, &backup_path).map_err(|e| {
            format!("recoverable_transaction: cannot preserve import destination: {e}")
        })?;
    }
    fs::rename(&publish_source, dest_folder).map_err(|error| {
        journal.state = crate::collection::import_transaction::TransactionState::RollbackPending;
        let _ = crate::collection::import_transaction::persist(&journal_root, &journal);
        format!("rollback_pending: asset commit failed: {error}")
    })?;
    crate::collection::import_transaction::set_operation_status(
        &journal_root,
        &mut journal,
        "asset-extract",
        "published",
    )
    .map_err(|e| e.to_string())?;
    journal.state = crate::collection::import_transaction::TransactionState::MetadataCommitting;
    crate::collection::import_transaction::persist(&journal_root, &journal)
        .map_err(|e| e.to_string())?;
    crate::collection::import_transaction::set_operation_status(
        &journal_root,
        &mut journal,
        "collection-metadata",
        "started",
    )
    .map_err(|e| e.to_string())?;
    manager::save_collection_to_path_during_transaction(collections_dir, &new_collection).map_err(
        |error| {
            journal.state =
                crate::collection::import_transaction::TransactionState::RollbackPending;
            let _ = crate::collection::import_transaction::persist(&journal_root, &journal);
            format!("rollback_pending: metadata commit failed: {error}")
        },
    )?;
    crate::collection::import_transaction::set_operation_status(
        &journal_root,
        &mut journal,
        "collection-metadata",
        "complete",
    )
    .map_err(|e| e.to_string())?;
    journal.state = crate::collection::import_transaction::TransactionState::Committed;
    crate::collection::import_transaction::persist(&journal_root, &journal)
        .map_err(|e| e.to_string())?;
    Ok(new_collection)
}

fn rebase_entry_paths(
    entries: &mut [Entry],
    staged_root: &Path,
    final_root: &Path,
) -> Result<(), String> {
    for entry in entries {
        match entry {
            Entry::File { path, .. } | Entry::FolderRef { path, .. } => {
                let staged = Path::new(path);
                let relative = staged.strip_prefix(staged_root).map_err(|_| {
                    "commit_failed: staged entry escaped destination root".to_string()
                })?;
                *path = crate::fs_ops::normalize_path(&final_root.join(relative).to_string_lossy());
            }
            Entry::Group { children, .. } => rebase_entry_paths(children, staged_root, final_root)?,
        }
    }
    Ok(())
}

fn extract_zip_assets<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    entries: &mut [Entry],
    dest_folder: &Path,
    resolutions: &HashMap<String, String>,
) -> Result<(), String> {
    let mut fault = None;
    extract_zip_assets_with_fault(archive, entries, dest_folder, resolutions, &mut fault)
}

fn extract_zip_assets_with_fault<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    entries: &mut [Entry],
    dest_folder: &Path,
    resolutions: &HashMap<String, String>,
    fault: &mut Option<usize>,
) -> Result<(), String> {
    for entry in entries {
        match entry {
            Entry::File { id, path } => {
                if let Some(remaining) = fault {
                    if *remaining == 0 {
                        return Err("stage_failed: injected ZIP extraction failure".to_string());
                    }
                    *remaining -= 1;
                }
                let relative_path = path.strip_prefix("assets/").unwrap_or(path);
                let target_path = dest_folder.join(relative_path);
                let ext = Path::new(relative_path)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("md");
                let id_zip_name = format!("assets/{}.{}", id, ext);
                let zip_name = if archive.by_name(path).is_ok() {
                    path.clone()
                } else {
                    id_zip_name
                };

                let resolution = resolutions
                    .get(id)
                    .or_else(|| resolutions.get(&zip_name))
                    .map(|s| s.as_str())
                    .unwrap_or("overwrite");
                if resolution == "skip" {
                    *path = crate::fs_ops::normalize_path(&target_path.to_string_lossy());
                    continue;
                }

                let final_path = if resolution == "rename" {
                    get_non_conflicting_path(&target_path)
                } else {
                    target_path
                };

                if let Ok(mut zip_file) = archive.by_name(&zip_name) {
                    if let Some(parent) = final_path.parent() {
                        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    let mut file_content = Vec::new();
                    zip_file
                        .read_to_end(&mut file_content)
                        .map_err(|e| format!("Failed to read file from ZIP: {}", e))?;
                    fs::write(&final_path, file_content)
                        .map_err(|e| format!("Failed to write extracted file: {}", e))?;
                }

                *path = crate::fs_ops::normalize_path(&final_path.to_string_lossy());
            }
            Entry::FolderRef { id, path } => {
                let relative_path = path.strip_prefix("assets/").unwrap_or(path);
                let target_path = dest_folder.join(relative_path);

                let resolution = resolutions
                    .get(id)
                    .map(|s| s.as_str())
                    .unwrap_or("overwrite");
                if resolution == "skip" {
                    *path = crate::fs_ops::normalize_path(&target_path.to_string_lossy());
                    continue;
                }

                let final_path = if resolution == "rename" {
                    get_non_conflicting_path(&target_path)
                } else {
                    target_path
                };

                let manifest_prefix = format!("{}/", path.trim_end_matches('/'));
                let id_prefix = format!("assets/{}/", id);
                let has_manifest_prefix = (0..archive.len()).any(|index| {
                    archive
                        .by_index(index)
                        .map(|file| file.name().starts_with(&manifest_prefix))
                        .unwrap_or(false)
                });
                let zip_prefix = if has_manifest_prefix {
                    manifest_prefix
                } else {
                    id_prefix
                };
                let archive_len = archive.len();
                for i in 0..archive_len {
                    let mut zip_file = archive
                        .by_index(i)
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
                            zip_file
                                .read_to_end(&mut file_content)
                                .map_err(|e| format!("Failed to read file from ZIP: {}", e))?;
                            fs::write(&target_file_path, file_content)
                                .map_err(|e| format!("Failed to write extracted file: {}", e))?;
                        }
                    }
                }

                *path = crate::fs_ops::normalize_path(&final_path.to_string_lossy());
            }
            Entry::Group { children, .. } => {
                extract_zip_assets_with_fault(archive, children, dest_folder, resolutions, fault)?;
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

    #[test]
    fn injected_staged_zip_failure_preserves_destination() {
        let temp = tempfile::tempdir().unwrap();
        let destination = temp.path().join("destination");
        fs::create_dir_all(&destination).unwrap();
        fs::write(destination.join("local.md"), b"local-before").unwrap();
        let zip_path = temp.path().join("input.zip");
        let file = File::create(&zip_path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        let manifest = serde_json::json!({
            "id": "fault", "schemaVersion": 1, "name": "Fault",
            "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z",
            "entries": [{"type": "file", "id": "note", "path": "assets/note.md"}], "metadata": null
        });
        zip.start_file("manifest.json", options).unwrap();
        zip.write_all(serde_json::to_string(&manifest).unwrap().as_bytes())
            .unwrap();
        zip.start_file("assets/note.md", options).unwrap();
        zip.write_all(b"new").unwrap();
        zip.finish().unwrap();
        let mut archive = ZipArchive::new(File::open(zip_path).unwrap()).unwrap();
        let mut entries = vec![Entry::File {
            id: "note".into(),
            path: "assets/note.md".into(),
        }];
        let stage = temp.path().join("stage");
        fs::create_dir_all(&stage).unwrap();
        let mut fault = Some(0usize);
        let error = extract_zip_assets_with_fault(
            &mut archive,
            &mut entries,
            &stage,
            &HashMap::new(),
            &mut fault,
        )
        .unwrap_err();
        assert!(error.contains("injected ZIP extraction failure"));
        assert_eq!(
            fs::read(destination.join("local.md")).unwrap(),
            b"local-before"
        );
        assert!(!destination.join("note.md").exists());
    }

    #[test]
    fn injected_folder_copy_failure_only_leaves_owned_stage() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        let stage = temp.path().join("stage");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("a.md"), b"a").unwrap();
        fs::write(source.join("b.md"), b"b").unwrap();
        let mut fault = Some(1usize);
        assert!(copy_dir_all_with_fault(&source, &stage, &mut fault).is_err());
        assert!(!temp.path().join("published").exists());
    }
}
