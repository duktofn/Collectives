mod legacy_source;
mod migration;
mod repository;
mod schema;

use crate::collection::{Collection, Entry};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MutationOperation {
    AddEntry {
        parent_path: Vec<usize>,
        entry: Entry,
    },
    RemoveEntry {
        entry_id: String,
    },
    MoveEntry {
        entry_id: String,
        parent_path: Vec<usize>,
        new_index: usize,
    },
    RenameGroup {
        group_id: String,
        name: String,
    },
    RelinkEntry {
        entry_id: String,
        path: String,
    },
    DeleteGroupAndPromote {
        group_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MutationRequest {
    pub collection_id: String,
    pub expected_revision: i64,
    pub mutation_id: String,
    pub operation: MutationOperation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MutationResult {
    pub collection_id: String,
    pub revision: i64,
    pub mutation_id: String,
    pub changes: serde_json::Value,
    pub idempotent_replay: bool,
    pub metrics: MutationMetrics,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MutationMetrics {
    pub changed_entry_rows: i64,
    pub changed_link_rows: i64,
    pub query_count: i64,
    pub full_rebuild: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MigrationStatus {
    pub mode: String,
    pub schema_version: i64,
    pub source_digest: String,
    pub target_digest: String,
    pub first_canonical_mutation: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangeFeedPage {
    pub collection_id: String,
    pub min_available_revision: i64,
    pub current_revision: i64,
    pub changes: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataSnapshot {
    pub collection: Collection,
    pub revision: i64,
    pub cursor: crate::fs_layer::watcher::WatchCursor,
}

pub use legacy_source::{
    flatten_collection, load_authoritative_snapshot, reconstruct_entries, simple_name_key,
    validate_entry_rows, LegacyCollectionRow, LegacyEntryRow, LegacyIndexRow, LegacySnapshot,
};
pub use migration::{
    detect_volume, BackupRecord, DurabilityEvidence, MetadataPaths, MetadataStateMarker,
    MigrationJournal, MigrationParity, MigrationResult, MigrationService, MigrationState,
    OperationStatus, OwnerMarker, RecoveryReport, VolumeCapability,
};
pub use repository::{SqliteMetadataLinkRepository, SqliteMetadataRepository};
pub use schema::{
    checkpoint_and_close, connection_evidence, create_schema, initialize_connection,
    integrity_report, SqlitePragmaEvidence, MUTATION_RETENTION_MAX, SCHEMA_VERSION,
    UI_CHANGE_RETENTION_MAX,
};
