use super::legacy_source::{
    load_authoritative_snapshot, reconstruct_entries, LegacyCollectionRow, LegacyEntryRow,
    LegacyIndexRow, LegacySnapshot,
};
use super::schema::{
    checkpoint_and_close, connection_evidence, initialize_connection, integrity_report,
    SqlitePragmaEvidence, SCHEMA_VERSION,
};
use crate::safety_error::SafetyError;
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MigrationState {
    Planned,
    Importing,
    Verifying,
    Publishing,
    Committed,
    RolledBack,
    RollbackPending,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MetadataPaths {
    pub collections_dir: PathBuf,
    pub journal_root: PathBuf,
    pub target_db: PathBuf,
    pub state_marker: PathBuf,
    pub legacy_index: PathBuf,
}

impl MetadataPaths {
    pub fn new(collections_dir: impl Into<PathBuf>) -> Self {
        let collections_dir = collections_dir.into();
        let journal_root = collections_dir
            .join(".collectives-metadata")
            .join("migrations")
            .join("v1");
        Self {
            target_db: collections_dir.join("metadata-v1.sqlite"),
            state_marker: collections_dir.join("metadata-v1.state"),
            legacy_index: collections_dir.join("link-index.db"),
            collections_dir,
            journal_root,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OwnerMarker {
    pub transaction_id: String,
    pub process_id: u32,
    pub owner: String,
    pub schema_version: i64,
    pub source_path: String,
    pub target_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BackupRecord {
    pub path: String,
    pub backup_path: String,
    pub before_digest: Option<String>,
    pub after_digest: Option<String>,
    pub existed_before: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OperationStatus {
    pub name: String,
    pub status: String,
    pub before_digest: Option<String>,
    pub after_digest: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DurabilityEvidence {
    pub stage_file_synced: bool,
    pub journal_file_synced: bool,
    pub marker_file_synced: bool,
    pub directory_sync_available: bool,
    pub wal_checkpoint_truncate: bool,
    pub wal_sidecars_clear: bool,
    pub volume_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MigrationJournal {
    pub schema_version: i64,
    pub transaction_id: String,
    pub state: MigrationState,
    pub owner: OwnerMarker,
    pub collections_dir: String,
    pub stage_db: String,
    pub target_db: String,
    pub state_marker: String,
    pub source_digest: String,
    pub target_digest: Option<String>,
    pub previous_marker: Option<MetadataStateMarker>,
    pub backups: Vec<BackupRecord>,
    pub operations: Vec<OperationStatus>,
    pub durability: DurabilityEvidence,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MetadataStateMarker {
    pub mode: String,
    pub schema_version: i64,
    pub transaction_id: String,
    pub source_digest: String,
    pub target_digest: String,
    pub first_canonical_mutation: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MigrationParity {
    pub collection_count: usize,
    pub entry_count: usize,
    pub index_count: usize,
    pub source_digest: String,
    pub collection_digest: String,
    pub entry_digest: String,
    pub index_digest: String,
    pub tree_digest: String,
    pub reconstructed_digest: String,
    pub integrity_check: String,
    pub foreign_keys_clean: bool,
    pub pragma: SqlitePragmaEvidence,
    pub wal_sidecars_clear: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MigrationResult {
    pub transaction_id: String,
    pub state: MigrationState,
    pub source_digest: String,
    pub target_digest: String,
    pub reused_existing: bool,
    pub parity: MigrationParity,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecoveryReport {
    pub recovered_transactions: Vec<String>,
    pub blocked_transactions: Vec<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VolumeCapability {
    pub same_volume: bool,
    pub detection: String,
    pub destructive_rename_allowed: bool,
}

#[derive(Clone)]
pub struct MigrationService {
    paths: MetadataPaths,
}

impl MigrationService {
    pub fn new(collections_dir: impl Into<PathBuf>) -> Self {
        Self {
            paths: MetadataPaths::new(collections_dir),
        }
    }

    pub fn paths(&self) -> &MetadataPaths {
        &self.paths
    }

    pub fn status(&self) -> Result<super::MigrationStatus, SafetyError> {
        match self.read_verified_marker()? {
            Some(marker) => Ok(super::MigrationStatus {
                mode: marker.mode,
                schema_version: marker.schema_version,
                source_digest: marker.source_digest,
                target_digest: marker.target_digest,
                first_canonical_mutation: marker.first_canonical_mutation,
            }),
            None => Ok(super::MigrationStatus {
                mode: "json_legacy".to_string(),
                schema_version: 0,
                source_digest: String::new(),
                target_digest: String::new(),
                first_canonical_mutation: false,
            }),
        }
    }

    pub fn recover(&self) -> Result<RecoveryReport, SafetyError> {
        ensure_directory(&self.paths.collections_dir)?;
        if !self.paths.journal_root.exists() {
            return Ok(RecoveryReport {
                recovered_transactions: Vec::new(),
                blocked_transactions: Vec::new(),
                status: "clean".to_string(),
            });
        }
        reject_reparse_root(&self.paths.journal_root)?;
        let mut recovered = Vec::new();
        let mut blocked = Vec::new();
        let mut transaction_dirs = Vec::new();
        for entry in fs::read_dir(&self.paths.journal_root)
            .map_err(io_error("metadata_recovery_scan_failed"))?
        {
            let path = entry
                .map_err(io_error("metadata_recovery_scan_failed"))?
                .path();
            if path.is_dir() {
                transaction_dirs.push(path);
            }
        }
        transaction_dirs.sort();
        for transaction_dir in transaction_dirs {
            let journal_path = transaction_dir.join("journal.json");
            let journal: MigrationJournal =
                read_json(&journal_path, "metadata_recovery_journal_invalid")?;
            self.validate_owned_transaction(&transaction_dir, &journal)?;
            match self.recover_journal(&transaction_dir, journal)? {
                RecoveryOutcome::Recovered(id) => recovered.push(id),
                RecoveryOutcome::Blocked(id) => blocked.push(id),
            }
        }
        if !blocked.is_empty() {
            return Err(SafetyError::new(
                "recoverable_metadata",
                "metadata migration recovery is blocked",
            )
            .with_details(serde_json::json!({ "transactions": blocked })));
        }
        Ok(RecoveryReport {
            recovered_transactions: recovered,
            blocked_transactions: blocked,
            status: "recovered".to_string(),
        })
    }

    pub fn migrate(&self) -> Result<MigrationResult, SafetyError> {
        self.recover()?;
        let existing_marker = self.read_verified_marker()?;
        if let Some(existing) = existing_marker {
            if existing.first_canonical_mutation {
                self.ensure_canonical_integrity()?;
                let parity = self.inspect_canonical()?;
                let target_digest = existing.target_digest.clone();
                return Ok(MigrationResult {
                    transaction_id: existing.transaction_id,
                    state: MigrationState::Committed,
                    source_digest: existing.source_digest,
                    target_digest,
                    reused_existing: true,
                    parity,
                });
            }
            let snapshot = load_authoritative_snapshot(&self.paths.collections_dir)?;
            if existing.source_digest != snapshot.source_digest {
                return Err(SafetyError::new("metadata_canonical_source_changed", "canonical SQLite metadata exists and legacy JSON differs; stale JSON fallback is forbidden"));
            }
            let target_digest = path_digest(&self.paths.target_db)?;
            if target_digest != existing.target_digest {
                return Err(SafetyError::new(
                    "recoverable_metadata",
                    "canonical SQLite digest does not match metadata-v1.state",
                ));
            }
            let parity = self.inspect_existing(&snapshot)?;
            return Ok(MigrationResult {
                transaction_id: existing.transaction_id,
                state: MigrationState::Committed,
                source_digest: existing.source_digest,
                target_digest,
                reused_existing: true,
                parity,
            });
        }
        let snapshot = load_authoritative_snapshot(&self.paths.collections_dir)?;
        let (transaction_dir, mut journal) = self.begin(&snapshot.source_digest)?;
        let stage_path = PathBuf::from(&journal.stage_db);
        let stage_parent = stage_path
            .parent()
            .ok_or_else(|| SafetyError::new("stage_failed", "stage database has no parent"))?;
        fs::create_dir_all(stage_parent).map_err(io_error("stage_failed"))?;
        let connection = Connection::open(&stage_path)
            .map_err(|error| SafetyError::new("stage_failed", error.to_string()))?;
        let pragma = initialize_connection(&connection)?;
        journal.durability = DurabilityEvidence {
            stage_file_synced: false,
            journal_file_synced: true,
            marker_file_synced: false,
            directory_sync_available: sync_directory(&self.paths.collections_dir),
            wal_checkpoint_truncate: false,
            wal_sidecars_clear: false,
            volume_mode: "staged-same-parent".to_string(),
        };
        set_state(&transaction_dir, &mut journal, MigrationState::Importing)?;
        import_snapshot(&connection, &snapshot)?;
        let parity = validate_parity(&connection, &snapshot, pragma.clone())?;
        journal.durability.wal_checkpoint_truncate = true;
        let sidecars_clear = checkpoint_and_close(connection, &stage_path)?;
        journal.durability.wal_sidecars_clear = sidecars_clear;
        journal.durability.stage_file_synced = sync_file(&stage_path)?;
        if !sidecars_clear {
            return Err(SafetyError::new(
                "metadata_checkpoint_failed",
                "SQLite WAL/SHM sidecar remained non-empty after TRUNCATE checkpoint",
            ));
        }
        if let Some(operation) = journal
            .operations
            .iter_mut()
            .find(|operation| operation.name == "publish-db")
        {
            operation.status = "verified".to_string();
        }
        set_state(&transaction_dir, &mut journal, MigrationState::Verifying)?;

        let capability = detect_volume(&stage_path, &self.paths.target_db);
        journal.durability.volume_mode = if capability.same_volume {
            "same-volume-rename"
        } else {
            "cross-volume-journalled-copy"
        }
        .to_string();
        if self.paths.target_db.exists() {
            let backup = transaction_dir.join("backup").join("metadata-v1.sqlite");
            fs::create_dir_all(backup.parent().unwrap())
                .map_err(io_error("recoverable_transaction"))?;
            let before = path_digest(&self.paths.target_db)?;
            fs::copy(&self.paths.target_db, &backup)
                .map_err(io_error("recoverable_transaction"))?;
            sync_file(&backup)?;
            journal.backups.push(BackupRecord {
                path: self.paths.target_db.to_string_lossy().into_owned(),
                backup_path: backup.to_string_lossy().into_owned(),
                before_digest: Some(before),
                after_digest: None,
                existed_before: true,
            });
        }
        persist_journal(&transaction_dir, &journal)?;
        set_state(&transaction_dir, &mut journal, MigrationState::Publishing)?;
        publish_stage(&stage_path, &self.paths.target_db, &capability)?;
        let target_digest = path_digest(&self.paths.target_db)?;
        journal.target_digest = Some(target_digest.clone());
        update_operation(
            &mut journal,
            "publish-db",
            "published",
            None,
            Some(target_digest.clone()),
        );
        persist_journal(&transaction_dir, &journal)?;
        let marker = MetadataStateMarker {
            mode: "sqlite_canonical".to_string(),
            schema_version: SCHEMA_VERSION,
            transaction_id: journal.transaction_id.clone(),
            source_digest: snapshot.source_digest.clone(),
            target_digest: target_digest.clone(),
            first_canonical_mutation: false,
        };
        persist_marker(&self.paths.state_marker, &marker)?;
        journal.durability.marker_file_synced = true;
        update_operation(
            &mut journal,
            "publish-state",
            "published",
            None,
            Some(path_digest(&self.paths.state_marker)?),
        );
        set_state(&transaction_dir, &mut journal, MigrationState::Committed)?;
        release_lease(&self.paths.journal_root, &journal.transaction_id)?;
        Ok(MigrationResult {
            transaction_id: journal.transaction_id,
            state: MigrationState::Committed,
            source_digest: snapshot.source_digest,
            target_digest,
            reused_existing: false,
            parity: MigrationParity {
                wal_sidecars_clear: sidecars_clear,
                ..parity
            },
        })
    }

    pub fn mark_first_canonical_mutation(&self) -> Result<(), SafetyError> {
        let mut marker = self.read_verified_marker()?.ok_or_else(|| {
            SafetyError::new(
                "metadata_migration_required",
                "SQLite canonical metadata is not published",
            )
        })?;
        marker.first_canonical_mutation = true;
        marker.target_digest = path_digest(&self.paths.target_db)?;
        persist_marker(&self.paths.state_marker, &marker)
    }

    pub fn ensure_canonical_integrity(&self) -> Result<(), SafetyError> {
        let marker = self.read_verified_marker()?.ok_or_else(|| {
            SafetyError::new(
                "metadata_migration_required",
                "SQLite canonical metadata is not published",
            )
        })?;
        let target_digest = path_digest(&self.paths.target_db)?;
        if target_digest != marker.target_digest {
            return Err(SafetyError::new(
                "recoverable_metadata",
                "canonical metadata is corrupt; legacy JSON fallback is forbidden",
            ));
        }
        let connection = Connection::open(&self.paths.target_db)
            .map_err(|error| SafetyError::new("recoverable_metadata", error.to_string()))?;
        let (integrity, foreign_keys) = integrity_report(&connection)?;
        if integrity != "ok" || !foreign_keys {
            return Err(SafetyError::new(
                "recoverable_metadata",
                "canonical metadata integrity check failed",
            ));
        }
        Ok(())
    }

    pub fn volume_capability(&self, source: &Path, target: &Path) -> VolumeCapability {
        detect_volume(source, target)
    }

    fn inspect_existing(&self, snapshot: &LegacySnapshot) -> Result<MigrationParity, SafetyError> {
        let connection = Connection::open(&self.paths.target_db)
            .map_err(|error| SafetyError::new("recoverable_metadata", error.to_string()))?;
        let pragma = connection_evidence(&connection)?;
        validate_parity(&connection, snapshot, pragma)
    }

    fn inspect_canonical(&self) -> Result<MigrationParity, SafetyError> {
        let connection = Connection::open(&self.paths.target_db)
            .map_err(|error| SafetyError::new("recoverable_metadata", error.to_string()))?;
        let pragma = connection_evidence(&connection)?;
        let collection_count = query_count(&connection, "SELECT COUNT(*) FROM collections")?;
        let entry_count = query_count(&connection, "SELECT COUNT(*) FROM entries")?;
        let index_count = query_count(&connection, "SELECT COUNT(*) FROM link_index")?;
        let (integrity_check, foreign_keys_clean) = integrity_report(&connection)?;
        Ok(MigrationParity {
            collection_count,
            entry_count,
            index_count,
            source_digest: "canonical-only".to_string(),
            collection_digest: "canonical-only".to_string(),
            entry_digest: "canonical-only".to_string(),
            index_digest: "canonical-only".to_string(),
            tree_digest: "canonical-only".to_string(),
            reconstructed_digest: "canonical-only".to_string(),
            integrity_check,
            foreign_keys_clean,
            pragma,
            wal_sidecars_clear: true,
        })
    }

    fn begin(&self, source_digest: &str) -> Result<(PathBuf, MigrationJournal), SafetyError> {
        ensure_directory(&self.paths.collections_dir)?;
        fs::create_dir_all(&self.paths.journal_root)
            .map_err(io_error("metadata_migration_init_failed"))?;
        reject_reparse_root(&self.paths.journal_root)?;
        let transaction_id = format!(
            "{}-{}-{}",
            Utc::now().format("%Y%m%d%H%M%S%3f"),
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        );
        let owner = OwnerMarker {
            transaction_id: transaction_id.clone(),
            process_id: std::process::id(),
            owner: format!(
                "{}@{}",
                std::env::var("USERNAME").unwrap_or_else(|_| "unknown".to_string()),
                std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string())
            ),
            schema_version: SCHEMA_VERSION,
            source_path: self.paths.collections_dir.to_string_lossy().into_owned(),
            target_path: self.paths.target_db.to_string_lossy().into_owned(),
        };
        let lease_path = self.paths.journal_root.join("active-lease.json");
        create_new_json(&lease_path, &owner)?;
        let transaction_dir = self.paths.journal_root.join(&transaction_id);
        if let Err(error) = fs::create_dir(&transaction_dir) {
            let _ = fs::remove_file(&lease_path);
            return Err(io_error("metadata_migration_init_failed")(error));
        }
        let stage = transaction_dir.join("stage").join("metadata-v1.sqlite");
        let mut journal = MigrationJournal {
            schema_version: SCHEMA_VERSION,
            transaction_id: transaction_id.clone(),
            state: MigrationState::Planned,
            owner,
            collections_dir: self.paths.collections_dir.to_string_lossy().into_owned(),
            stage_db: stage.to_string_lossy().into_owned(),
            target_db: self.paths.target_db.to_string_lossy().into_owned(),
            state_marker: self.paths.state_marker.to_string_lossy().into_owned(),
            source_digest: source_digest.to_string(),
            target_digest: None,
            previous_marker: read_json_if_exists(&self.paths.state_marker)?,
            backups: Vec::new(),
            operations: vec![
                OperationStatus {
                    name: "publish-db".to_string(),
                    status: "planned".to_string(),
                    before_digest: None,
                    after_digest: None,
                },
                OperationStatus {
                    name: "publish-state".to_string(),
                    status: "planned".to_string(),
                    before_digest: None,
                    after_digest: None,
                },
            ],
            durability: DurabilityEvidence {
                stage_file_synced: false,
                journal_file_synced: false,
                marker_file_synced: false,
                directory_sync_available: sync_directory(&self.paths.collections_dir),
                wal_checkpoint_truncate: false,
                wal_sidecars_clear: false,
                volume_mode: "undetermined".to_string(),
            },
            created_at: Utc::now().to_rfc3339(),
        };
        persist_journal(&transaction_dir, &journal)?;
        journal.durability.journal_file_synced = true;
        persist_journal(&transaction_dir, &journal)?;
        Ok((transaction_dir, journal))
    }

    fn read_verified_marker(&self) -> Result<Option<MetadataStateMarker>, SafetyError> {
        if !self.paths.state_marker.exists() {
            return Ok(None);
        }
        let marker: MetadataStateMarker =
            read_json(&self.paths.state_marker, "metadata_state_invalid")?;
        if marker.schema_version != SCHEMA_VERSION || marker.mode != "sqlite_canonical" {
            return Err(SafetyError::new(
                "metadata_state_unsupported",
                "unsupported metadata-v1.state",
            ));
        }
        if !self.paths.target_db.exists() {
            return Err(SafetyError::new(
                "recoverable_metadata",
                "metadata-v1.state exists without canonical SQLite",
            ));
        }
        Ok(Some(marker))
    }

    fn validate_owned_transaction(
        &self,
        transaction_dir: &Path,
        journal: &MigrationJournal,
    ) -> Result<(), SafetyError> {
        if journal.schema_version != SCHEMA_VERSION
            || journal.transaction_id
                != transaction_dir
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("")
        {
            return Err(SafetyError::new(
                "recoverable_transaction",
                "metadata journal identity/version mismatch",
            ));
        }
        if Path::new(&journal.collections_dir) != self.paths.collections_dir
            || Path::new(&journal.target_db) != self.paths.target_db
            || Path::new(&journal.state_marker) != self.paths.state_marker
        {
            return Err(SafetyError::new(
                "recoverable_transaction",
                "metadata journal root/path ownership mismatch",
            ));
        }
        let expected_stage = transaction_dir.join("stage").join("metadata-v1.sqlite");
        if Path::new(&journal.stage_db) != expected_stage {
            return Err(SafetyError::new(
                "recoverable_transaction",
                "metadata stage path is not exact marker-owned path",
            ));
        }
        if !is_under(transaction_dir, &expected_stage)
            || !is_under(transaction_dir, &transaction_dir.join("journal.json"))
        {
            return Err(SafetyError::new(
                "recoverable_transaction",
                "metadata journal path escapes owned transaction",
            ));
        }
        for backup in &journal.backups {
            let expected_backup = transaction_dir.join("backup").join("metadata-v1.sqlite");
            if Path::new(&backup.path) != self.paths.target_db
                || Path::new(&backup.backup_path) != expected_backup
                || !is_under(transaction_dir, Path::new(&backup.backup_path))
            {
                return Err(SafetyError::new(
                    "recoverable_transaction",
                    "metadata backup manifest path is not exact marker-owned path",
                ));
            }
        }
        reject_reparse_root(transaction_dir)
    }

    fn recover_journal(
        &self,
        transaction_dir: &Path,
        mut journal: MigrationJournal,
    ) -> Result<RecoveryOutcome, SafetyError> {
        match journal.state {
            MigrationState::Planned | MigrationState::Importing | MigrationState::Verifying => {
                let stage = PathBuf::from(&journal.stage_db);
                if stage.exists() {
                    fs::remove_file(&stage).map_err(io_error("recoverable_transaction"))?;
                }
                journal.state = MigrationState::RolledBack;
                persist_journal(transaction_dir, &journal)?;
                release_lease(&self.paths.journal_root, &journal.transaction_id)?;
                Ok(RecoveryOutcome::Recovered(journal.transaction_id))
            }
            MigrationState::Publishing => {
                let target_matches = journal.target_digest.as_ref().is_some_and(|digest| {
                    self.paths.target_db.exists()
                        && path_digest(&self.paths.target_db).ok().as_ref() == Some(digest)
                });
                if target_matches {
                    let target_digest = journal.target_digest.clone().unwrap();
                    let marker = MetadataStateMarker {
                        mode: "sqlite_canonical".to_string(),
                        schema_version: SCHEMA_VERSION,
                        transaction_id: journal.transaction_id.clone(),
                        source_digest: journal.source_digest.clone(),
                        target_digest,
                        first_canonical_mutation: false,
                    };
                    persist_marker(&self.paths.state_marker, &marker)?;
                    journal.state = MigrationState::Committed;
                    persist_journal(transaction_dir, &journal)?;
                    release_lease(&self.paths.journal_root, &journal.transaction_id)?;
                    Ok(RecoveryOutcome::Recovered(journal.transaction_id))
                } else if let Some(backup) = journal.backups.first() {
                    restore_backup(backup)?;
                    journal.state = MigrationState::RolledBack;
                    persist_journal(transaction_dir, &journal)?;
                    release_lease(&self.paths.journal_root, &journal.transaction_id)?;
                    Ok(RecoveryOutcome::Recovered(journal.transaction_id))
                } else {
                    if self.paths.target_db.exists() {
                        fs::remove_file(&self.paths.target_db)
                            .map_err(io_error("rollback_pending"))?;
                    }
                    journal.state = MigrationState::RolledBack;
                    persist_journal(transaction_dir, &journal)?;
                    release_lease(&self.paths.journal_root, &journal.transaction_id)?;
                    Ok(RecoveryOutcome::Recovered(journal.transaction_id))
                }
            }
            MigrationState::Committed => {
                self.ensure_committed(&journal)?;
                release_lease(&self.paths.journal_root, &journal.transaction_id)?;
                Ok(RecoveryOutcome::Recovered(journal.transaction_id))
            }
            MigrationState::RolledBack => {
                release_lease(&self.paths.journal_root, &journal.transaction_id)?;
                Ok(RecoveryOutcome::Recovered(journal.transaction_id))
            }
            MigrationState::RollbackPending => Ok(RecoveryOutcome::Blocked(journal.transaction_id)),
        }
    }

    fn ensure_committed(&self, journal: &MigrationJournal) -> Result<(), SafetyError> {
        let marker: MetadataStateMarker =
            read_json(&self.paths.state_marker, "recoverable_transaction")?;
        if marker.transaction_id != journal.transaction_id || !self.paths.target_db.exists() {
            return Err(SafetyError::new(
                "recoverable_transaction",
                "committed metadata journal does not match published bundle",
            ));
        }
        if !marker.first_canonical_mutation
            && marker.target_digest != journal.target_digest.clone().unwrap_or_default()
        {
            return Err(SafetyError::new(
                "recoverable_transaction",
                "committed metadata journal does not match published bundle",
            ));
        }
        if path_digest(&self.paths.target_db)? != marker.target_digest {
            return Err(SafetyError::new(
                "recoverable_transaction",
                "published metadata digest changed",
            ));
        }
        Ok(())
    }
}

enum RecoveryOutcome {
    Recovered(String),
    Blocked(String),
}

fn import_snapshot(connection: &Connection, snapshot: &LegacySnapshot) -> Result<(), SafetyError> {
    let tx = connection
        .unchecked_transaction()
        .map_err(|error| SafetyError::new("metadata_import_failed", error.to_string()))?;
    for collection in &snapshot.collections {
        tx.execute("INSERT INTO collections(id,name,name_key,created_at,updated_at,metadata_json,revision) VALUES(?1,?2,?3,?4,?5,?6,0)", params![collection.id, collection.name, collection.name_key, collection.created_at, collection.updated_at, collection.metadata_json]).map_err(|error| SafetyError::new("metadata_import_failed", error.to_string()))?;
    }
    for row in &snapshot.entries {
        tx.execute("INSERT INTO entries(collection_id,id,parent_id,entry_type,name,path,sort_order) VALUES(?1,?2,?3,?4,?5,?6,?7)", params![row.collection_id, row.id, row.parent_id, row.entry_type, row.name, row.path, row.sort_order]).map_err(|error| SafetyError::new("metadata_import_failed", error.to_string()))?;
    }
    for row in &snapshot.index {
        tx.execute("INSERT INTO link_index(collection_id,entry_id,display_name,path,entry_type,source_revision) VALUES(?1,?2,?3,?4,?5,0)", params![row.collection_id, row.entry_id, row.display_name, row.path, row.entry_type]).map_err(|error| SafetyError::new("metadata_import_failed", error.to_string()))?;
    }
    for collection in &snapshot.collections {
        tx.execute("INSERT INTO change_feed_state(collection_id,min_available_revision,current_revision,updated_at) VALUES(?1,0,0,'phase3-migration-v1')", params![collection.id]).map_err(|error| SafetyError::new("metadata_import_failed", error.to_string()))?;
    }
    tx.execute("INSERT INTO migration_state(id,mode,schema_version,source_digest,target_digest,first_canonical_mutation,updated_at) VALUES(1,'sqlite_staging',1,?1,'pending',0,'phase3-migration-v1')", params![snapshot.source_digest]).map_err(|error| SafetyError::new("metadata_import_failed", error.to_string()))?;
    tx.commit()
        .map_err(|error| SafetyError::new("metadata_import_failed", error.to_string()))
}

fn validate_parity(
    connection: &Connection,
    snapshot: &LegacySnapshot,
    pragma: SqlitePragmaEvidence,
) -> Result<MigrationParity, SafetyError> {
    let collection_count = query_count(connection, "SELECT COUNT(*) FROM collections")?;
    let entry_count = query_count(connection, "SELECT COUNT(*) FROM entries")?;
    let index_count = query_count(connection, "SELECT COUNT(*) FROM link_index")?;
    if collection_count != snapshot.collections.len()
        || entry_count != snapshot.entries.len()
        || index_count != snapshot.index.len()
    {
        return Err(SafetyError::new(
            "metadata_parity_failed",
            "staged SQLite row counts differ from authoritative JSON",
        ));
    }
    let (integrity_check, foreign_keys_clean) = integrity_report(connection)?;
    if integrity_check != "ok" || !foreign_keys_clean {
        return Err(SafetyError::new(
            "metadata_integrity_failed",
            "staged SQLite integrity check failed",
        ));
    }
    let mut collection_rows = Vec::new();
    let mut collection_statement = connection
        .prepare("SELECT id,name,name_key,created_at,updated_at,metadata_json FROM collections ORDER BY id")
        .map_err(|error| SafetyError::new("metadata_parity_failed", error.to_string()))?;
    let collection_result = collection_statement
        .query_map([], |row| {
            Ok(LegacyCollectionRow {
                id: row.get(0)?,
                name: row.get(1)?,
                name_key: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                metadata_json: row.get(5)?,
            })
        })
        .map_err(|error| SafetyError::new("metadata_parity_failed", error.to_string()))?;
    for row in collection_result {
        collection_rows.push(
            row.map_err(|error| SafetyError::new("metadata_parity_failed", error.to_string()))?,
        );
    }
    let mut expected_collections = snapshot.collections.clone();
    expected_collections.sort_by(|left, right| left.id.cmp(&right.id));
    if collection_rows != expected_collections {
        return Err(SafetyError::new(
            "metadata_parity_failed",
            "staged collection rows differ from authoritative JSON",
        ));
    }
    let collection_digest = digest_json(&collection_rows)?;

    let mut rows = Vec::new();
    let mut statement = connection.prepare("SELECT collection_id,id,parent_id,entry_type,name,path,sort_order FROM entries ORDER BY collection_id,id").map_err(|error| SafetyError::new("metadata_parity_failed", error.to_string()))?;
    let result = statement
        .query_map([], |row| {
            Ok(LegacyEntryRow {
                collection_id: row.get(0)?,
                id: row.get(1)?,
                parent_id: row.get(2)?,
                entry_type: row.get(3)?,
                name: row.get(4)?,
                path: row.get(5)?,
                sort_order: row.get(6)?,
            })
        })
        .map_err(|error| SafetyError::new("metadata_parity_failed", error.to_string()))?;
    for row in result {
        rows.push(
            row.map_err(|error| SafetyError::new("metadata_parity_failed", error.to_string()))?,
        );
    }
    let mut expected_rows = snapshot.entries.clone();
    expected_rows.sort_by(|left, right| {
        (left.collection_id.clone(), left.id.clone())
            .cmp(&(right.collection_id.clone(), right.id.clone()))
    });
    if rows != expected_rows {
        return Err(SafetyError::new(
            "metadata_parity_failed",
            "staged entry rows differ from authoritative JSON flattening",
        ));
    }
    let entry_digest = digest_json(&rows)?;
    let mut index_rows = Vec::new();
    let mut index_statement = connection
        .prepare("SELECT collection_id,entry_id,display_name,path,entry_type FROM link_index ORDER BY collection_id,entry_id")
        .map_err(|error| SafetyError::new("metadata_parity_failed", error.to_string()))?;
    let index_result = index_statement
        .query_map([], |row| {
            Ok(LegacyIndexRow {
                collection_id: row.get(0)?,
                entry_id: row.get(1)?,
                display_name: row.get(2)?,
                path: row.get(3)?,
                entry_type: row.get(4)?,
            })
        })
        .map_err(|error| SafetyError::new("metadata_parity_failed", error.to_string()))?;
    for row in index_result {
        index_rows.push(
            row.map_err(|error| SafetyError::new("metadata_parity_failed", error.to_string()))?,
        );
    }
    let mut expected_index = snapshot.index.clone();
    expected_index.sort_by(|left, right| {
        (left.collection_id.clone(), left.entry_id.clone())
            .cmp(&(right.collection_id.clone(), right.entry_id.clone()))
    });
    if index_rows != expected_index {
        return Err(SafetyError::new(
            "metadata_parity_failed",
            "staged link index rows differ from authoritative JSON paths",
        ));
    }
    let index_digest = digest_json(&index_rows)?;
    let mut trees = Vec::new();
    for collection in &snapshot.collections {
        trees.push((
            collection.id.clone(),
            reconstruct_entries(&snapshot.entries, &collection.id)?,
        ));
    }
    let tree_digest = digest_json(&trees)?;
    Ok(MigrationParity {
        collection_count,
        entry_count,
        index_count,
        source_digest: snapshot.source_digest.clone(),
        collection_digest,
        entry_digest: entry_digest.clone(),
        index_digest,
        tree_digest,
        reconstructed_digest: entry_digest,
        integrity_check,
        foreign_keys_clean,
        pragma,
        wal_sidecars_clear: false,
    })
}

fn digest_json<T: serde::Serialize>(value: &T) -> Result<String, SafetyError> {
    let bytes = serde_json::to_vec(value)
        .map_err(|error| SafetyError::new("metadata_parity_failed", error.to_string()))?;
    Ok(blake3::hash(&bytes).to_hex().to_string())
}

fn query_count(connection: &Connection, sql: &str) -> Result<usize, SafetyError> {
    connection
        .query_row(sql, [], |row| row.get::<_, i64>(0))
        .map(|value| value as usize)
        .map_err(|error| SafetyError::new("metadata_parity_failed", error.to_string()))
}

fn set_state(
    transaction_dir: &Path,
    journal: &mut MigrationJournal,
    state: MigrationState,
) -> Result<(), SafetyError> {
    journal.state = state;
    persist_journal(transaction_dir, journal)
}
fn update_operation(
    journal: &mut MigrationJournal,
    name: &str,
    status: &str,
    before: Option<String>,
    after: Option<String>,
) {
    if let Some(operation) = journal
        .operations
        .iter_mut()
        .find(|operation| operation.name == name)
    {
        operation.status = status.to_string();
        operation.before_digest = before;
        operation.after_digest = after;
    }
}

fn publish_stage(
    stage: &Path,
    target: &Path,
    capability: &VolumeCapability,
) -> Result<(), SafetyError> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(io_error("commit_failed"))?;
    }
    if capability.same_volume {
        replace_path(stage, target)
    } else {
        let temporary = target.with_file_name(format!(
            "{}.phase3-copy",
            target
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("metadata-v1.sqlite")
        ));
        fs::copy(stage, &temporary).map_err(io_error("recoverable_transaction"))?;
        sync_file(&temporary)?;
        replace_path(&temporary, target)
    }
}

fn restore_backup(backup: &BackupRecord) -> Result<(), SafetyError> {
    let target = Path::new(&backup.path);
    let source = Path::new(&backup.backup_path);
    if !source.exists() || path_digest(source)? != backup.before_digest.clone().unwrap_or_default()
    {
        return Err(SafetyError::new(
            "rollback_pending",
            "owned metadata backup is missing or has an unexpected digest",
        ));
    }
    if target.exists() {
        fs::remove_file(target).map_err(io_error("rollback_pending"))?;
    }
    replace_path(source, target)
}

fn replace_path(source: &Path, target: &Path) -> Result<(), SafetyError> {
    #[cfg(windows)]
    {
        windows_replace(source, target)
    }
    #[cfg(not(windows))]
    {
        fs::rename(source, target).map_err(io_error("commit_failed"))
    }
}

#[cfg(windows)]
fn windows_replace(source: &Path, target: &Path) -> Result<(), SafetyError> {
    use std::os::windows::ffi::OsStrExt;
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    let source_w: Vec<u16> = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let target_w: Vec<u16> = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    if unsafe {
        MoveFileExW(
            source_w.as_ptr(),
            target_w.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        return Err(SafetyError::new(
            "recoverable_transaction",
            format!(
                "verified Windows replacement failed: {}",
                std::io::Error::last_os_error()
            ),
        ));
    }
    Ok(())
}

pub fn detect_volume(source: &Path, target: &Path) -> VolumeCapability {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let source_meta = nearest_existing(source).and_then(|path| fs::metadata(path).ok());
        let target_meta = nearest_existing(target).and_then(|path| fs::metadata(path).ok());
        match (source_meta, target_meta) {
            (Some(source), Some(target)) => {
                let same = source.dev() == target.dev();
                VolumeCapability {
                    same_volume: same,
                    detection: format!("st_dev:{}:{}", source.dev(), target.dev()),
                    destructive_rename_allowed: same,
                }
            }
            _ => VolumeCapability {
                same_volume: false,
                detection: "st_dev-unavailable".to_string(),
                destructive_rename_allowed: false,
            },
        }
    }
    #[cfg(windows)]
    {
        let source_root = source
            .components()
            .next()
            .map(|component| component.as_os_str().to_string_lossy().to_ascii_lowercase());
        let target_root = target
            .components()
            .next()
            .map(|component| component.as_os_str().to_string_lossy().to_ascii_lowercase());
        let same = source_root.is_some() && source_root == target_root;
        VolumeCapability {
            same_volume: same,
            detection: "drive-root".to_string(),
            destructive_rename_allowed: same,
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        VolumeCapability {
            same_volume: false,
            detection: "volume-identifier-unavailable".to_string(),
            destructive_rename_allowed: false,
        }
    }
}

#[cfg(unix)]
fn nearest_existing(path: &Path) -> Option<PathBuf> {
    let mut current = path.to_path_buf();
    while !current.exists() {
        if !current.pop() {
            return None;
        }
    }
    Some(current)
}

fn ensure_directory(path: &Path) -> Result<(), SafetyError> {
    if path.exists() && !path.is_dir() {
        return Err(SafetyError::new(
            "metadata_root_invalid",
            format!("{} is not a directory", path.display()),
        ));
    }
    fs::create_dir_all(path).map_err(io_error("metadata_root_invalid"))
}
fn reject_reparse_root(path: &Path) -> Result<(), SafetyError> {
    if fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(SafetyError::new(
            "metadata_root_invalid",
            format!("symlink/reparse root rejected: {}", path.display()),
        ));
    }
    Ok(())
}
fn is_under(root: &Path, candidate: &Path) -> bool {
    candidate == root || candidate.strip_prefix(root).is_ok()
}
fn path_digest(path: &Path) -> Result<String, SafetyError> {
    let mut file = File::open(path).map_err(io_error("metadata_digest_failed"))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(io_error("metadata_digest_failed"))?;
    Ok(blake3::hash(&bytes).to_hex().to_string())
}
fn sync_file(path: &Path) -> Result<bool, SafetyError> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(io_error("metadata_sync_failed"))?;
    file.sync_all().map_err(io_error("metadata_sync_failed"))?;
    Ok(true)
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> bool {
    File::open(path).and_then(|file| file.sync_all()).is_ok()
}
#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> bool {
    false
}

fn persist_journal(transaction_dir: &Path, journal: &MigrationJournal) -> Result<(), SafetyError> {
    persist_json(&transaction_dir.join("journal.json"), journal)
}
fn persist_marker(path: &Path, marker: &MetadataStateMarker) -> Result<(), SafetyError> {
    persist_json(path, marker)
}
fn persist_json<T: Serialize>(path: &Path, value: &T) -> Result<(), SafetyError> {
    let temporary = path.with_file_name(format!(
        ".{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("metadata")
    ));
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| SafetyError::new("metadata_journal_failed", error.to_string()))?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temporary)
        .map_err(io_error("metadata_journal_failed"))?;
    file.write_all(&bytes)
        .map_err(io_error("metadata_journal_failed"))?;
    file.sync_all()
        .map_err(io_error("metadata_journal_failed"))?;
    drop(file);
    replace_path(&temporary, path)?;
    let _ = sync_directory(path.parent().unwrap_or_else(|| Path::new(".")));
    Ok(())
}
fn create_new_json<T: Serialize>(path: &Path, value: &T) -> Result<(), SafetyError> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| SafetyError::new("metadata_lease_failed", error.to_string()))?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                SafetyError::new(
                    "metadata_busy",
                    "another metadata migration lease is active",
                )
            } else {
                SafetyError::new("metadata_lease_failed", error.to_string())
            }
        })?;
    file.write_all(&bytes)
        .map_err(io_error("metadata_lease_failed"))?;
    file.sync_all().map_err(io_error("metadata_lease_failed"))?;
    Ok(())
}
fn read_json<T: for<'de> Deserialize<'de>>(
    path: &Path,
    code: &'static str,
) -> Result<T, SafetyError> {
    let data = fs::read(path).map_err(io_error(code))?;
    serde_json::from_slice(&data).map_err(|error| SafetyError::new(code, error.to_string()))
}
fn read_json_if_exists<T: for<'de> Deserialize<'de>>(
    path: &Path,
) -> Result<Option<T>, SafetyError> {
    if path.exists() {
        read_json(path, "metadata_state_invalid").map(Some)
    } else {
        Ok(None)
    }
}
fn release_lease(root: &Path, transaction_id: &str) -> Result<(), SafetyError> {
    let path = root.join("active-lease.json");
    if !path.exists() {
        return Ok(());
    }
    let owner: OwnerMarker = read_json(&path, "recoverable_transaction")?;
    if owner.transaction_id != transaction_id {
        return Err(SafetyError::new(
            "recoverable_transaction",
            "active metadata lease is owned by a different transaction",
        ));
    }
    fs::remove_file(path).map_err(io_error("metadata_lease_failed"))
}
fn io_error(code: &'static str) -> impl Fn(std::io::Error) -> SafetyError {
    move |error| SafetyError::new(code, error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metadata::legacy_source::{reconstruct_entries, validate_entry_rows};

    #[test]
    fn detects_same_and_cross_volume_conservatively() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("stage.sqlite");
        File::create(&source).unwrap();
        let capability = detect_volume(&source, &temp.path().join("target.sqlite"));
        assert!(capability.destructive_rename_allowed);
        assert!(capability.detection.contains("st_dev") || capability.detection == "drive-root");
    }

    #[test]
    fn row_validation_rejects_orphans_cycles_and_duplicate_order() {
        let rows = vec![LegacyEntryRow {
            collection_id: "c".into(),
            id: "a".into(),
            parent_id: Some("missing".into()),
            entry_type: "file".into(),
            name: None,
            path: Some("a.md".into()),
            sort_order: 0,
        }];
        assert_eq!(
            validate_entry_rows(&rows).unwrap_err().code,
            "metadata_orphan_entry"
        );
        let rows = vec![
            LegacyEntryRow {
                collection_id: "c".into(),
                id: "a".into(),
                parent_id: Some("b".into()),
                entry_type: "group".into(),
                name: Some("a".into()),
                path: None,
                sort_order: 0,
            },
            LegacyEntryRow {
                collection_id: "c".into(),
                id: "b".into(),
                parent_id: Some("a".into()),
                entry_type: "group".into(),
                name: Some("b".into()),
                path: None,
                sort_order: 0,
            },
        ];
        assert_eq!(
            validate_entry_rows(&rows).unwrap_err().code,
            "metadata_cycle"
        );
        let rows = vec![
            LegacyEntryRow {
                collection_id: "c".into(),
                id: "a".into(),
                parent_id: None,
                entry_type: "file".into(),
                name: None,
                path: Some("a".into()),
                sort_order: 0,
            },
            LegacyEntryRow {
                collection_id: "c".into(),
                id: "b".into(),
                parent_id: None,
                entry_type: "file".into(),
                name: None,
                path: Some("b".into()),
                sort_order: 0,
            },
        ];
        assert_eq!(
            validate_entry_rows(&rows).unwrap_err().code,
            "metadata_duplicate_order"
        );
        assert!(reconstruct_entries(&rows, "c").is_err());
    }

    fn test_journal(service: &MigrationService) -> (PathBuf, MigrationJournal) {
        service.begin("source-test").unwrap()
    }

    #[test]
    fn persisted_recovery_resolves_planned_importing_verifying_and_publishing_states() {
        for state in [
            MigrationState::Planned,
            MigrationState::Importing,
            MigrationState::Verifying,
        ] {
            let temp = tempfile::tempdir().unwrap();
            let service = MigrationService::new(temp.path());
            let (transaction_dir, mut journal) = test_journal(&service);
            let stage = PathBuf::from(&journal.stage_db);
            fs::create_dir_all(stage.parent().unwrap()).unwrap();
            fs::write(&stage, b"owned stage").unwrap();
            set_state(&transaction_dir, &mut journal, state).unwrap();
            let report = service.recover().unwrap();
            assert_eq!(report.status, "recovered");
            assert!(!stage.exists());
        }

        let temp = tempfile::tempdir().unwrap();
        let service = MigrationService::new(temp.path());
        let (transaction_dir, mut journal) = test_journal(&service);
        fs::write(&service.paths.target_db, b"owned new target").unwrap();
        journal.target_digest = Some("not-the-target".into());
        set_state(&transaction_dir, &mut journal, MigrationState::Publishing).unwrap();
        service.recover().unwrap();
        assert!(!service.paths.target_db.exists());
    }

    #[test]
    fn persisted_publishing_backup_restores_and_committed_requires_exact_digest() {
        let temp = tempfile::tempdir().unwrap();
        let service = MigrationService::new(temp.path());
        let (transaction_dir, mut journal) = test_journal(&service);
        let backup_path = transaction_dir.join("backup").join("metadata-v1.sqlite");
        fs::create_dir_all(backup_path.parent().unwrap()).unwrap();
        fs::write(&backup_path, b"before").unwrap();
        fs::write(&service.paths.target_db, b"after").unwrap();
        journal.backups.push(BackupRecord {
            path: service.paths.target_db.to_string_lossy().into_owned(),
            backup_path: backup_path.to_string_lossy().into_owned(),
            before_digest: Some(path_digest(&backup_path).unwrap()),
            after_digest: None,
            existed_before: true,
        });
        set_state(&transaction_dir, &mut journal, MigrationState::Publishing).unwrap();
        service.recover().unwrap();
        assert_eq!(fs::read(&service.paths.target_db).unwrap(), b"before");

        let temp = tempfile::tempdir().unwrap();
        let service = MigrationService::new(temp.path());
        let (transaction_dir, mut journal) = test_journal(&service);
        fs::write(&service.paths.target_db, b"committed").unwrap();
        let digest = path_digest(&service.paths.target_db).unwrap();
        let marker = MetadataStateMarker {
            mode: "sqlite_canonical".into(),
            schema_version: SCHEMA_VERSION,
            transaction_id: journal.transaction_id.clone(),
            source_digest: "source-test".into(),
            target_digest: digest.clone(),
            first_canonical_mutation: false,
        };
        persist_marker(&service.paths.state_marker, &marker).unwrap();
        journal.target_digest = Some(digest);
        set_state(&transaction_dir, &mut journal, MigrationState::Committed).unwrap();
        service.recover().unwrap();
        assert!(!service
            .paths
            .journal_root
            .join("active-lease.json")
            .exists());
    }

    #[test]
    fn rollback_pending_and_tampered_owned_paths_block_without_cleanup() {
        let temp = tempfile::tempdir().unwrap();
        let service = MigrationService::new(temp.path());
        let (transaction_dir, mut journal) = test_journal(&service);
        let stage = PathBuf::from(&journal.stage_db);
        fs::create_dir_all(stage.parent().unwrap()).unwrap();
        fs::write(&stage, b"must remain").unwrap();
        set_state(
            &transaction_dir,
            &mut journal,
            MigrationState::RollbackPending,
        )
        .unwrap();
        let error = service.recover().unwrap_err();
        assert_eq!(error.code, "recoverable_metadata");
        assert!(stage.exists());

        let temp = tempfile::tempdir().unwrap();
        let service = MigrationService::new(temp.path());
        let (transaction_dir, mut journal) = test_journal(&service);
        journal.stage_db = service.paths.target_db.to_string_lossy().into_owned();
        persist_journal(&transaction_dir, &journal).unwrap();
        let error = service.recover().unwrap_err();
        assert_eq!(error.code, "recoverable_transaction");
    }
}
