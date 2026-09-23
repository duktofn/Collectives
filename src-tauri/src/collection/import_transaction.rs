use crate::safety_error::SafetyError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TransactionState {
    Planned,
    Staged,
    AssetsCommitting,
    MetadataCommitting,
    Committed,
    RollbackPending,
    RolledBack,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionJournal {
    pub schema_version: u32,
    pub transaction_id: String,
    pub state: TransactionState,
    pub collections_dir: String,
    pub destination_root: String,
    pub stage_root: String,
    #[serde(default)]
    pub publish_stage_root: Option<String>,
    #[serde(default)]
    pub backup_stage_root: Option<String>,
    pub before_metadata_sha256: Option<String>,
    pub operations: Vec<String>,
    #[serde(default)]
    pub owner_marker: String,
    #[serde(default)]
    pub backup_manifest: Vec<BackupRecord>,
    #[serde(default)]
    pub operation_status: HashMap<String, String>,
    #[serde(default)]
    pub cross_volume: bool,
    #[serde(default)]
    pub fsync_capability: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupRecord {
    pub original: String,
    pub backup: String,
    pub before_sha256: Option<String>,
    pub after_sha256: Option<String>,
}

pub fn path_digest(path: &Path) -> Result<String, SafetyError> {
    if path.is_file() {
        let bytes = fs::read(path).map_err(|e| {
            SafetyError::new(
                "recoverable_transaction",
                format!("cannot read digest source: {e}"),
            )
        })?;
        return Ok(blake3::hash(&bytes).to_hex().to_string());
    }
    if path.is_dir() {
        let mut children = fs::read_dir(path)
            .map_err(|e| SafetyError::new("recoverable_transaction", e.to_string()))?
            .map(|entry| {
                entry
                    .map(|entry| entry.path())
                    .map_err(|e| SafetyError::new("recoverable_transaction", e.to_string()))
            })
            .collect::<Result<Vec<_>, _>>()?;
        children.sort();
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"collectives-directory-v1\0");
        for child in children {
            let name = child
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| SafetyError::new("recoverable_transaction", "invalid path name"))?;
            hasher.update(name.as_bytes());
            hasher.update(b"\0");
            hasher.update(path_digest(&child)?.as_bytes());
            hasher.update(b"\0");
        }
        return Ok(hasher.finalize().to_hex().to_string());
    }
    Err(SafetyError::new(
        "recoverable_transaction",
        format!("digest source does not exist: {}", path.display()),
    ))
}

fn sync_directory(path: &Path) -> Result<(), SafetyError> {
    #[cfg(unix)]
    {
        fs::File::open(path)
            .and_then(|file| file.sync_all())
            .map_err(|e| {
                SafetyError::new(
                    "recoverable_transaction",
                    format!("directory fsync failed: {e}"),
                )
            })?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

pub fn fsync_capability() -> &'static str {
    if cfg!(unix) {
        "file-sync-all+directory-fsync"
    } else {
        "file-sync-all+directory-fsync-unavailable"
    }
}

fn existing_volume_device(path: &Path) -> Result<u64, SafetyError> {
    let mut existing = path;
    while !existing.exists() {
        existing = existing.parent().ok_or_else(|| {
            SafetyError::new(
                "recoverable_transaction",
                format!("filesystem device is unavailable for {}", path.display()),
            )
        })?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        return fs::metadata(existing)
            .map(|metadata| metadata.dev())
            .map_err(|error| {
                SafetyError::new(
                    "recoverable_transaction",
                    format!(
                        "filesystem device lookup failed for {}: {error}",
                        existing.display()
                    ),
                )
            });
    }
    #[cfg(windows)]
    {
        let prefix = existing.components().next().ok_or_else(|| {
            SafetyError::new(
                "recoverable_transaction",
                format!("filesystem volume is unavailable for {}", path.display()),
            )
        })?;
        let mut value = 0u64;
        for byte in prefix.as_os_str().to_string_lossy().bytes() {
            value = value.wrapping_mul(257).wrapping_add(byte as u64);
        }
        Ok(value)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = existing;
        Err(SafetyError::new(
            "recoverable_transaction",
            "filesystem device capability is unavailable on this platform",
        ))
    }
}

fn same_volume(left: &Path, right: &Path) -> Result<bool, SafetyError> {
    #[cfg(windows)]
    {
        let left_device = existing_volume_device(left)?;
        let right_device = existing_volume_device(right)?;
        Ok(left_device == right_device)
    }
    #[cfg(unix)]
    {
        Ok(existing_volume_device(left)? == existing_volume_device(right)?)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (left, right);
        Err(SafetyError::new(
            "recoverable_transaction",
            "filesystem volume capability is unavailable on this platform",
        ))
    }
}

fn path_is_within(path: &Path, parent: &Path) -> bool {
    let path = path.to_string_lossy().to_lowercase();
    let parent = parent.to_string_lossy().to_lowercase();
    path == parent
        || path.starts_with(&format!("{}{}", parent, std::path::MAIN_SEPARATOR))
        || path.starts_with(&format!("{}/", parent))
}

fn validate_path_components(path: &Path) -> Result<(), SafetyError> {
    if path.as_os_str().is_empty() || path.components().count() <= 1 {
        return Err(SafetyError::new(
            "recoverable_transaction",
            "transaction root cannot be a drive or filesystem root",
        ));
    }
    let mut existing = path;
    while !existing.exists() {
        existing = existing.parent().ok_or_else(|| {
            SafetyError::new("recoverable_transaction", "path has no existing ancestor")
        })?;
    }
    let mut cursor = Some(existing);
    while let Some(component) = cursor {
        let metadata = fs::symlink_metadata(component)
            .map_err(|e| SafetyError::new("recoverable_transaction", e.to_string()))?;
        if metadata.file_type().is_symlink() {
            return Err(SafetyError::new(
                "recoverable_transaction",
                "transaction path cannot contain a symlink/reparse component",
            ));
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(SafetyError::new(
                    "recoverable_transaction",
                    "transaction path cannot contain a reparse component",
                ));
            }
        }
        cursor = component.parent();
    }
    Ok(())
}

pub fn transaction_root(collections_dir: &Path) -> PathBuf {
    collections_dir.join(".collectives-transactions/v1")
}

pub fn create_journal(
    collections_dir: &Path,
    destination_root: &Path,
    operations: Vec<String>,
    before_metadata: Option<&Path>,
) -> Result<TransactionJournal, SafetyError> {
    validate_path_components(collections_dir)?;
    validate_path_components(destination_root)?;
    let id = Uuid::new_v4().to_string();
    let transactions_root = transaction_root(collections_dir);
    fs::create_dir_all(&transactions_root).map_err(|e| {
        SafetyError::new(
            "recoverable_transaction",
            format!("cannot create transaction root: {e}"),
        )
    })?;
    sync_directory(&transactions_root)?;
    let root = transactions_root.join(&id);
    fs::create_dir_all(&root).map_err(|e| {
        SafetyError::new(
            "recoverable_transaction",
            format!("cannot create transaction journal: {e}"),
        )
    })?;
    let marker = root.join(".collectives-owner");
    let mut marker_file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&marker)
        .map_err(|e| SafetyError::new("recoverable_transaction", e.to_string()))?;
    marker_file
        .write_all(format!("collectives-phase1-v1\n{id}\n").as_bytes())
        .map_err(|e| SafetyError::new("recoverable_transaction", e.to_string()))?;
    marker_file
        .sync_all()
        .map_err(|e| SafetyError::new("recoverable_transaction", e.to_string()))?;
    sync_directory(&root)?;
    let journal = TransactionJournal {
        schema_version: 1,
        transaction_id: id,
        state: TransactionState::Planned,
        collections_dir: collections_dir.to_string_lossy().into_owned(),
        destination_root: destination_root.to_string_lossy().into_owned(),
        stage_root: root.join("stage").to_string_lossy().into_owned(),
        publish_stage_root: None,
        backup_stage_root: None,
        before_metadata_sha256: before_metadata.and_then(|p| path_digest(p).ok()),
        operations,
        owner_marker: marker.to_string_lossy().into_owned(),
        backup_manifest: Vec::new(),
        operation_status: HashMap::new(),
        cross_volume: !same_volume(collections_dir, destination_root)?,
        fsync_capability: fsync_capability().to_string(),
    };
    persist(&root, &journal)?;
    Ok(journal)
}

pub fn transition(
    root: &Path,
    journal: &mut TransactionJournal,
    state: TransactionState,
) -> Result<(), SafetyError> {
    journal.state = state;
    persist(root, journal)
}

pub fn set_operation_status(
    root: &Path,
    journal: &mut TransactionJournal,
    operation: &str,
    status: &str,
) -> Result<(), SafetyError> {
    journal
        .operation_status
        .insert(operation.to_string(), status.to_string());
    persist(root, journal)
}

pub fn add_backup(
    root: &Path,
    journal: &mut TransactionJournal,
    original: &Path,
    backup: &Path,
    before_sha256: Option<String>,
    after_sha256: Option<String>,
) -> Result<(), SafetyError> {
    if !path_is_within(original, Path::new(&journal.destination_root)) {
        return Err(SafetyError::new(
            "recoverable_transaction",
            "original must remain inside the declared destination root",
        ));
    }
    let backup_owned = path_is_within(backup, root)
        || journal
            .backup_stage_root
            .as_deref()
            .is_some_and(|backup_root| path_is_within(backup, Path::new(backup_root)));
    if !backup_owned {
        return Err(SafetyError::new(
            "recoverable_transaction",
            "backup must remain inside owned transaction root",
        ));
    }
    let before_sha256 = before_sha256.or_else(|| {
        if original.exists() {
            path_digest(original).ok()
        } else {
            None
        }
    });
    journal.backup_manifest.push(BackupRecord {
        original: original.to_string_lossy().into_owned(),
        backup: backup.to_string_lossy().into_owned(),
        before_sha256,
        after_sha256,
    });
    persist(root, journal)
}

pub fn persist(root: &Path, journal: &TransactionJournal) -> Result<(), SafetyError> {
    let temp = root.join("journal.json.tmp");
    let final_path = root.join("journal.json");
    let data = serde_json::to_vec_pretty(journal)
        .map_err(|e| SafetyError::new("recoverable_transaction", e.to_string()))?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temp)
        .map_err(|e| {
            SafetyError::new(
                "recoverable_transaction",
                format!("journal write failed: {e}"),
            )
        })?;
    file.write_all(&data).map_err(|e| {
        SafetyError::new(
            "recoverable_transaction",
            format!("journal write failed: {e}"),
        )
    })?;
    file.sync_all().map_err(|e| {
        SafetyError::new(
            "recoverable_transaction",
            format!("journal fsync failed: {e}"),
        )
    })?;
    drop(file);
    fs::rename(&temp, &final_path).map_err(|e| {
        SafetyError::new(
            "recoverable_transaction",
            format!("journal replace failed: {e}"),
        )
    })?;
    sync_directory(root)?;
    Ok(())
}

fn remove_owned_path(path: &Path) -> Result<(), SafetyError> {
    if path.is_dir() {
        fs::remove_dir_all(path)
    } else if path.exists() {
        fs::remove_file(path)
    } else {
        Ok(())
    }
    .map_err(|e| SafetyError::new("rollback_pending", e.to_string()))
}

fn restore_backup(
    transaction_root: &Path,
    journal: &TransactionJournal,
    backup: &BackupRecord,
) -> Result<(), SafetyError> {
    let original = PathBuf::from(&backup.original);
    let backup_path = PathBuf::from(&backup.backup);
    let backup_owned = path_is_within(&backup_path, transaction_root)
        || journal
            .backup_stage_root
            .as_deref()
            .is_some_and(|backup_root| path_is_within(&backup_path, Path::new(backup_root)));
    if !path_is_within(&original, Path::new(&journal.destination_root)) || !backup_owned {
        return Err(SafetyError::new(
            "recoverable_transaction",
            "backup path ownership validation failed",
        ));
    }
    if let Some(before) = &backup.before_sha256 {
        if path_digest(&original).ok().as_deref() == Some(before.as_str()) {
            return Ok(());
        }
        if !backup_path.exists() {
            return Err(SafetyError::new(
                "rollback_pending",
                "durable backup is missing before restoration",
            ));
        }
        if original.exists() {
            let displaced = transaction_root.join("rollback-displaced").join(format!(
                "{}-{}",
                original
                    .file_name()
                    .and_then(|v| v.to_str())
                    .unwrap_or("original"),
                Uuid::new_v4()
            ));
            fs::create_dir_all(displaced.parent().unwrap())
                .map_err(|e| SafetyError::new("rollback_pending", e.to_string()))?;
            fs::rename(&original, &displaced)
                .map_err(|e| SafetyError::new("rollback_pending", e.to_string()))?;
        }
        fs::rename(&backup_path, &original)
            .map_err(|e| SafetyError::new("rollback_pending", e.to_string()))?;
        if path_digest(&original).ok().as_deref() != Some(before.as_str()) {
            return Err(SafetyError::new(
                "rollback_pending",
                "restored backup digest does not match the journal",
            ));
        }
    } else {
        if !original.exists() {
            return Ok(());
        }
        let after = backup.after_sha256.as_deref().ok_or_else(|| {
            SafetyError::new("rollback_pending", "new output has no after digest")
        })?;
        if path_digest(&original)? != after {
            return Err(SafetyError::new(
                "rollback_pending",
                "refusing to remove an output whose digest is not journal-owned",
            ));
        }
        remove_owned_path(&original)?;
    }
    Ok(())
}

pub fn recover(collections_dir: &Path) -> Result<(), SafetyError> {
    let root = transaction_root(collections_dir);
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(&root)
        .map_err(|e| SafetyError::new("recoverable_transaction", e.to_string()))?
    {
        let entry =
            entry.map_err(|e| SafetyError::new("recoverable_transaction", e.to_string()))?;
        let path = entry.path();
        if !path.is_dir() || path.file_name().and_then(|v| v.to_str()).is_none() {
            continue;
        }
        let journal_path = path.join("journal.json");
        if !journal_path.is_file() {
            continue;
        }
        let mut journal: TransactionJournal = serde_json::from_slice(
            &fs::read(&journal_path)
                .map_err(|e| SafetyError::new("recoverable_transaction", e.to_string()))?,
        )
        .map_err(|e| SafetyError::new("recoverable_transaction", e.to_string()))?;
        let expected_id = path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or_default();
        let expected_root = root.join(expected_id);
        let marker_contents = fs::read_to_string(&journal.owner_marker).unwrap_or_default();
        if journal.schema_version != 1
            || journal.transaction_id != expected_id
            || journal.collections_dir != collections_dir.to_string_lossy()
            || !path_is_within(Path::new(&journal.stage_root), &expected_root)
            || Path::new(&journal.stage_root) != expected_root.join("stage")
            || journal.owner_marker != expected_root.join(".collectives-owner").to_string_lossy()
            || marker_contents != format!("collectives-phase1-v1\n{}\n", journal.transaction_id)
        {
            return Err(SafetyError::new(
                "recoverable_transaction",
                "transaction ownership/path validation failed",
            )
            .with_details(serde_json::json!({"transactionId": journal.transaction_id})));
        }
        validate_path_components(Path::new(&journal.destination_root))?;
        if let Some(publish_root) = &journal.publish_stage_root {
            let publish_path = Path::new(publish_root);
            let expected_name = format!(".collectives-stage-{}", journal.transaction_id);
            let expected_parent =
                Path::new(&journal.destination_root)
                    .parent()
                    .ok_or_else(|| {
                        SafetyError::new("recoverable_transaction", "destination has no parent")
                    })?;
            if publish_path.file_name().and_then(|v| v.to_str()) != Some(expected_name.as_str())
                || publish_path.parent() != Some(expected_parent)
                || !publish_path.join(".collectives-owner").is_file()
                || fs::read_to_string(publish_path.join(".collectives-owner")).unwrap_or_default()
                    != format!("collectives-phase1-v1\n{}\n", journal.transaction_id)
            {
                return Err(SafetyError::new(
                    "recoverable_transaction",
                    "cross-volume publish stage ownership validation failed",
                ));
            }
        }
        if let Some(backup_root) = &journal.backup_stage_root {
            let backup_path = Path::new(backup_root);
            let expected_name = format!(".collectives-backup-{}", journal.transaction_id);
            let expected_parent =
                Path::new(&journal.destination_root)
                    .parent()
                    .ok_or_else(|| {
                        SafetyError::new("recoverable_transaction", "destination has no parent")
                    })?;
            if backup_path.file_name().and_then(|v| v.to_str()) != Some(expected_name.as_str())
                || backup_path.parent() != Some(expected_parent)
                || !backup_path.join(".collectives-owner").is_file()
                || fs::read_to_string(backup_path.join(".collectives-owner")).unwrap_or_default()
                    != format!("collectives-phase1-v1\n{}\n", journal.transaction_id)
            {
                return Err(SafetyError::new(
                    "recoverable_transaction",
                    "cross-volume backup ownership validation failed",
                ));
            }
        }
        match journal.state {
            TransactionState::Planned | TransactionState::Staged => {
                let stage = PathBuf::from(&journal.stage_root);
                remove_owned_path(&stage)?;
                if let Some(publish_root) = &journal.publish_stage_root {
                    remove_owned_path(Path::new(publish_root))?;
                }
                if let Some(backup_root) = &journal.backup_stage_root {
                    remove_owned_path(Path::new(backup_root))?;
                }
                journal.state = TransactionState::RolledBack;
                journal
                    .operation_status
                    .insert("recovery".into(), "rolled-back-before-commit".into());
                persist(&path, &journal)?;
            }
            TransactionState::Committed => {
                let stage = PathBuf::from(&journal.stage_root);
                let final_valid = journal.backup_manifest.iter().all(|backup| {
                    backup.after_sha256.as_ref().is_none_or(|after| {
                        let original = Path::new(&backup.original);
                        original.exists()
                            && path_digest(original).ok().as_deref() == Some(after.as_str())
                    })
                });
                let backup_still_present = journal
                    .backup_manifest
                    .iter()
                    .any(|backup| Path::new(&backup.backup).exists());
                if !final_valid && !backup_still_present {
                    journal
                        .operation_status
                        .insert("recovery".into(), "superseded-by-later-commit".into());
                    persist(&path, &journal)?;
                    continue;
                }
                if !final_valid {
                    journal.state = TransactionState::RollbackPending;
                    journal
                        .operation_status
                        .insert("recovery".into(), "committed-verification-failed".into());
                    persist(&path, &journal)?;
                    return Err(SafetyError::new(
                        "recoverable_transaction",
                        "committed transaction final digest verification failed",
                    ));
                }
                remove_owned_path(&stage)?;
                if let Some(publish_root) = &journal.publish_stage_root {
                    remove_owned_path(Path::new(publish_root))?;
                }
                if let Some(backup_root) = &journal.backup_stage_root {
                    remove_owned_path(Path::new(backup_root))?;
                }
                for backup in &journal.backup_manifest {
                    let backup_path = PathBuf::from(&backup.backup);
                    let backup_owned = path_is_within(&backup_path, &expected_root)
                        || journal
                            .backup_stage_root
                            .as_deref()
                            .is_some_and(|backup_root| {
                                path_is_within(&backup_path, Path::new(backup_root))
                            });
                    if !backup_owned {
                        return Err(SafetyError::new(
                            "recoverable_transaction",
                            "backup cleanup path is outside transaction root",
                        ));
                    }
                    remove_owned_path(&backup_path)?;
                }
            }
            TransactionState::RollbackPending => {
                return Err(SafetyError::new(
                    "recoverable_transaction",
                    "transaction rollback is pending; mutation is blocked",
                )
                .with_details(serde_json::json!({"transactionId": journal.transaction_id})))
            }
            TransactionState::AssetsCommitting | TransactionState::MetadataCommitting => {
                let restore_result = journal
                    .backup_manifest
                    .iter()
                    .try_for_each(|backup| restore_backup(&expected_root, &journal, backup));
                if let Err(error) = restore_result {
                    journal.state = TransactionState::RollbackPending;
                    journal
                        .operation_status
                        .insert("recovery".into(), "rollback-pending".into());
                    persist(&path, &journal)?;
                    return Err(error);
                }
                remove_owned_path(Path::new(&journal.stage_root))?;
                if let Some(publish_root) = &journal.publish_stage_root {
                    remove_owned_path(Path::new(publish_root))?;
                }
                if let Some(backup_root) = &journal.backup_stage_root {
                    remove_owned_path(Path::new(backup_root))?;
                }
                journal.state = TransactionState::RolledBack;
                journal
                    .operation_status
                    .insert("recovery".into(), "rolled-back-after-commit-failure".into());
                persist(&path, &journal)?;
            }
            TransactionState::RolledBack => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    mod unix_tests {
        use super::super::{existing_volume_device, same_volume};
        use std::fs;

        #[test]
        fn unix_device_capability_detects_same_mount_for_missing_child() {
            let temp = tempfile::tempdir().unwrap();
            let existing = temp.path().join("existing");
            fs::create_dir_all(&existing).unwrap();
            let missing_child = existing.join("not-created").join("destination");
            assert_eq!(
                existing_volume_device(&existing).unwrap(),
                existing_volume_device(&missing_child).unwrap()
            );
            assert!(same_volume(&existing, &missing_child).unwrap());
        }
    }

    #[cfg(not(any(unix, windows)))]
    mod unsupported_tests {
        use super::super::same_volume;
        use std::path::Path;

        #[test]
        fn unsupported_platform_fails_closed_for_volume_capability() {
            let error = same_volume(Path::new("left"), Path::new("right")).unwrap_err();
            assert_eq!(error.code, "recoverable_transaction");
        }
    }
}
