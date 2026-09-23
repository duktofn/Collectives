use crate::safety_error::SafetyError;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const SCHEMA_VERSION: i64 = 1;
pub const MUTATION_RETENTION_MAX: i64 = 50_000;
pub const UI_CHANGE_RETENTION_MAX: i64 = 10_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SqlitePragmaEvidence {
    pub foreign_keys: bool,
    pub journal_mode: String,
    pub synchronous: String,
    pub busy_timeout_ms: i64,
}

pub fn initialize_connection(connection: &Connection) -> Result<SqlitePragmaEvidence, SafetyError> {
    let evidence = connection_evidence(connection)?;
    create_schema(connection)?;
    Ok(evidence)
}

pub fn connection_evidence(connection: &Connection) -> Result<SqlitePragmaEvidence, SafetyError> {
    connection
        .pragma_update(None, "foreign_keys", true)
        .map_err(|error| SafetyError::new("metadata_sqlite_init_failed", error.to_string()))?;
    connection
        .busy_timeout(std::time::Duration::from_millis(5000))
        .map_err(|error| SafetyError::new("metadata_sqlite_init_failed", error.to_string()))?;
    let journal_mode: String = connection
        .pragma_query_value(None, "journal_mode", |row| row.get(0))
        .map_err(|error| SafetyError::new("metadata_sqlite_init_failed", error.to_string()))?;
    let journal_mode = if journal_mode.eq_ignore_ascii_case("wal") {
        journal_mode
    } else {
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(|error| SafetyError::new("metadata_sqlite_init_failed", error.to_string()))?;
        connection
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .map_err(|error| SafetyError::new("metadata_sqlite_init_failed", error.to_string()))?
    };
    if !journal_mode.eq_ignore_ascii_case("wal") {
        return Err(SafetyError::new(
            "metadata_sqlite_init_failed",
            "SQLite WAL mode was not accepted",
        ));
    }
    connection
        .pragma_update(None, "synchronous", "NORMAL")
        .map_err(|error| SafetyError::new("metadata_sqlite_init_failed", error.to_string()))?;
    Ok(SqlitePragmaEvidence {
        foreign_keys: connection
            .pragma_query_value(None, "foreign_keys", |row| row.get::<_, i64>(0))
            .map_err(|error| SafetyError::new("metadata_sqlite_init_failed", error.to_string()))?
            != 0,
        journal_mode,
        synchronous: connection
            .pragma_query_value(None, "synchronous", |row| row.get::<_, i64>(0))
            .map_err(|error| SafetyError::new("metadata_sqlite_init_failed", error.to_string()))?
            .to_string(),
        busy_timeout_ms: connection
            .pragma_query_value(None, "busy_timeout", |row| row.get(0))
            .map_err(|error| SafetyError::new("metadata_sqlite_init_failed", error.to_string()))?,
    })
}

pub fn create_schema(connection: &Connection) -> Result<(), SafetyError> {
    connection
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS schema_migrations(
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL,
                digest TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS collections(
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                name_key TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                metadata_json TEXT,
                revision INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS entries(
                collection_id TEXT NOT NULL,
                id TEXT NOT NULL,
                parent_id TEXT,
                entry_type TEXT NOT NULL CHECK(entry_type IN ('file','folder-ref','group')),
                name TEXT,
                path TEXT,
                sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
                PRIMARY KEY(collection_id, id),
                FOREIGN KEY(collection_id) REFERENCES collections(id) ON DELETE CASCADE,
                FOREIGN KEY(collection_id, parent_id) REFERENCES entries(collection_id, id) ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS entries_root_order
                ON entries(collection_id, sort_order) WHERE parent_id IS NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS entries_child_order
                ON entries(collection_id, parent_id, sort_order) WHERE parent_id IS NOT NULL;
            CREATE INDEX IF NOT EXISTS entries_parent_lookup
                ON entries(collection_id, parent_id, sort_order, id);
            CREATE TABLE IF NOT EXISTS collection_changes(
                collection_id TEXT NOT NULL,
                revision INTEGER NOT NULL,
                mutation_id TEXT NOT NULL,
                changes_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY(collection_id, revision),
                UNIQUE(collection_id, mutation_id),
                FOREIGN KEY(collection_id) REFERENCES collections(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS mutation_records(
                collection_id TEXT NOT NULL,
                mutation_id TEXT NOT NULL,
                revision INTEGER NOT NULL,
                result_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY(collection_id, mutation_id),
                FOREIGN KEY(collection_id) REFERENCES collections(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS mutation_records_revision
                ON mutation_records(collection_id, revision);
            CREATE TABLE IF NOT EXISTS change_feed_state(
                collection_id TEXT PRIMARY KEY,
                min_available_revision INTEGER NOT NULL,
                current_revision INTEGER NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(collection_id) REFERENCES collections(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS link_index(
                collection_id TEXT NOT NULL,
                entry_id TEXT NOT NULL,
                display_name TEXT NOT NULL,
                path TEXT NOT NULL,
                entry_type TEXT NOT NULL,
                source_revision INTEGER NOT NULL,
                PRIMARY KEY(collection_id, entry_id),
                FOREIGN KEY(collection_id, entry_id) REFERENCES entries(collection_id, id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS link_index_display_name
                ON link_index(collection_id, display_name COLLATE NOCASE);
            CREATE TABLE IF NOT EXISTS migration_state(
                id INTEGER PRIMARY KEY CHECK(id = 1),
                mode TEXT NOT NULL,
                schema_version INTEGER NOT NULL,
                source_digest TEXT NOT NULL,
                target_digest TEXT NOT NULL,
                first_canonical_mutation INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS migration_backups(
                transaction_id TEXT NOT NULL,
                path TEXT NOT NULL,
                backup_path TEXT NOT NULL,
                before_digest TEXT,
                after_digest TEXT,
                PRIMARY KEY(transaction_id, path)
            );
            INSERT OR IGNORE INTO schema_migrations(version, applied_at, digest)
                VALUES(1, 'phase3-schema-v1', 'phase3-schema-v1');
            "#,
        )
        .map_err(|error| SafetyError::new("metadata_schema_failed", error.to_string()))
}

pub fn integrity_report(connection: &Connection) -> Result<(String, bool), SafetyError> {
    let integrity: String = connection
        .pragma_query_value(None, "integrity_check", |row| row.get(0))
        .map_err(|error| SafetyError::new("metadata_integrity_failed", error.to_string()))?;
    let mut foreign_key_statement = connection
        .prepare("PRAGMA foreign_key_check")
        .map_err(|error| SafetyError::new("metadata_integrity_failed", error.to_string()))?;
    let mut foreign_key_rows = foreign_key_statement
        .query([])
        .map_err(|error| SafetyError::new("metadata_integrity_failed", error.to_string()))?;
    let foreign_keys_clean = foreign_key_rows
        .next()
        .map_err(|error| SafetyError::new("metadata_integrity_failed", error.to_string()))?
        .is_none();
    Ok((integrity, foreign_keys_clean))
}

pub fn checkpoint_and_close(connection: Connection, db_path: &Path) -> Result<bool, SafetyError> {
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|error| SafetyError::new("metadata_checkpoint_failed", error.to_string()))?;
    drop(connection);
    let wal = db_path.with_file_name(format!(
        "{}-wal",
        db_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("metadata-v1.sqlite")
    ));
    let shm = db_path.with_file_name(format!(
        "{}-shm",
        db_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("metadata-v1.sqlite")
    ));
    Ok(!nonzero_file(&wal)? && !nonzero_file(&shm)?)
}

fn nonzero_file(path: &Path) -> Result<bool, SafetyError> {
    match std::fs::metadata(path) {
        Ok(metadata) => Ok(metadata.len() > 0),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(SafetyError::new(
            "metadata_sidecar_check_failed",
            error.to_string(),
        )),
    }
}
