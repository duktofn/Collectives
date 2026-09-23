use super::legacy_source::{flatten_collection, reconstruct_entries, LegacyEntryRow};
use super::migration::MigrationService;
use super::schema::{connection_evidence, MUTATION_RETENTION_MAX, UI_CHANGE_RETENTION_MAX};
use crate::application::domain::{Collection, CollectionMetadata, Entry};
use crate::metadata::{
    ChangeFeedPage, MigrationStatus, MutationMetrics, MutationOperation, MutationRequest,
    MutationResult,
};
use crate::repositories::ports::LinkRepository;
use crate::repositories::ports::{CollectionRepository, MetadataRepository};
use crate::safety_error::SafetyError;
use rusqlite::{params, Connection, Error as SqliteError};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

const ORDER_OFFSET: i64 = 1_000_000;
const BUSY_DELAYS_MS: [u64; 5] = [10, 25, 50, 100, 200];

#[derive(Clone)]
pub struct SqliteMetadataRepository {
    db_path: PathBuf,
    collections_dir: PathBuf,
    migration: MigrationService,
}

#[derive(Clone)]
pub struct SqliteMetadataLinkRepository {
    db_path: PathBuf,
}

impl SqliteMetadataLinkRepository {
    pub fn new(collections_dir: impl Into<PathBuf>) -> Self {
        let root = collections_dir.into();
        Self {
            db_path: root.join("metadata-v1.sqlite"),
        }
    }
}

impl LinkRepository for SqliteMetadataLinkRepository {
    fn update_collection(&self, _collection: &Collection) -> Result<(), String> {
        Ok(())
    }
    fn clear_collection(&self, collection_id: &str) -> Result<(), String> {
        let connection = Connection::open(&self.db_path).map_err(|error| error.to_string())?;
        connection_evidence(&connection).map_err(|error| error.to_string())?;
        connection
            .execute(
                "DELETE FROM link_index WHERE collection_id=?1",
                params![collection_id],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }
    fn resolve(
        &self,
        collection_id: &str,
        note_name: &str,
    ) -> Result<Option<crate::link_index::IndexEntry>, String> {
        let connection = Connection::open(&self.db_path).map_err(|error| error.to_string())?;
        connection_evidence(&connection).map_err(|error| error.to_string())?;
        connection.query_row("SELECT display_name,collection_id,entry_id,path,entry_type FROM link_index WHERE collection_id=?1 AND display_name=?2 COLLATE NOCASE LIMIT 1", params![collection_id,note_name], |row| Ok(crate::link_index::IndexEntry { display_name: row.get(0)?, collection_id: row.get(1)?, entry_id: row.get(2)?, path: row.get(3)?, entry_type: row.get(4)? })).optional().map_err(|error| error.to_string())
    }
    fn search(
        &self,
        collection_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<crate::link_index::IndexEntry>, String> {
        let connection = Connection::open(&self.db_path).map_err(|error| error.to_string())?;
        connection_evidence(&connection).map_err(|error| error.to_string())?;
        let escaped = query.replace('%', "\\%").replace('_', "\\_");
        let mut statement = connection.prepare("SELECT display_name,collection_id,entry_id,path,entry_type FROM link_index WHERE collection_id=?1 AND display_name LIKE ?2 ESCAPE '\\' COLLATE NOCASE LIMIT ?3").map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(
                params![collection_id, format!("%{escaped}%"), limit],
                |row| {
                    Ok(crate::link_index::IndexEntry {
                        display_name: row.get(0)?,
                        collection_id: row.get(1)?,
                        entry_id: row.get(2)?,
                        path: row.get(3)?,
                        entry_type: row.get(4)?,
                    })
                },
            )
            .map_err(|error| error.to_string())?;
        rows.map(|row| row.map_err(|error| error.to_string()))
            .collect()
    }
    fn path(&self) -> &Path {
        &self.db_path
    }
}

impl SqliteMetadataRepository {
    pub fn new(collections_dir: impl Into<PathBuf>) -> Self {
        let collections_dir = collections_dir.into();
        Self {
            db_path: collections_dir.join("metadata-v1.sqlite"),
            migration: MigrationService::new(&collections_dir),
            collections_dir,
        }
    }

    pub fn from_app(app: &tauri::AppHandle) -> Result<Self, String> {
        let collections_dir = crate::collection::manager::get_collections_dir(app)?;
        MigrationService::new(&collections_dir)
            .migrate()
            .map_err(|error| error.to_string())?;
        Ok(Self::new(collections_dir))
    }

    pub fn collections_dir(&self) -> &Path {
        &self.collections_dir
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    pub fn read_changes_since(
        &self,
        collection_id: &str,
        after_revision: i64,
    ) -> Result<ChangeFeedPage, SafetyError> {
        self.with_connection(|connection| {
            let (min_available, current): (i64, i64) = connection.query_row("SELECT min_available_revision,current_revision FROM change_feed_state WHERE collection_id=?1", params![collection_id], |row| Ok((row.get(0)?, row.get(1)?))).map_err(|error| format!("metadata_not_found: {error}"))?;
            if after_revision < min_available.saturating_sub(1) { return Err("snapshot_required: retained collection_changes no longer cover requested revision".into()); }
            let mut statement = connection.prepare("SELECT changes_json FROM collection_changes WHERE collection_id=?1 AND revision>?2 ORDER BY revision").map_err(|error| error.to_string())?;
            let rows = statement.query_map(params![collection_id, after_revision], |row| row.get::<_, String>(0)).map_err(|error| error.to_string())?;
            let mut changes = Vec::new();
            for row in rows { changes.push(serde_json::from_str(&row.map_err(|error| error.to_string())?).map_err(|error| format!("metadata_change_decode: {error}"))?); }
            Ok(ChangeFeedPage { collection_id: collection_id.to_string(), min_available_revision: min_available, current_revision: current, changes })
        }).map_err(metadata_error)
    }

    pub fn save_full_compatibility(
        &self,
        collection: &Collection,
    ) -> Result<MutationMetrics, String> {
        let (full_entries, full_index) =
            flatten_collection(collection).map_err(|error| error.to_string())?;
        self.with_connection(|connection| {
            connection
                .execute_batch("BEGIN IMMEDIATE")
                .map_err(|error| error.to_string())?;
            let mutation_id = format!("compatibility-save-{}", uuid::Uuid::new_v4());
            let result = save_incremental_in_transaction(connection, collection, &mutation_id);
            match result {
                Ok(_) => {
                    connection
                        .execute_batch("COMMIT")
                        .map_err(|error| error.to_string())?;
                    Ok(MutationMetrics {
                        changed_entry_rows: full_entries.len() as i64,
                        changed_link_rows: full_index.len() as i64,
                        query_count: 0,
                        full_rebuild: true,
                    })
                }
                Err(error) => {
                    let _ = connection.execute_batch("ROLLBACK");
                    Err(error)
                }
            }
        })
    }

    pub fn with_connection<T>(
        &self,
        operation: impl Fn(&Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut last_error = None;
        for delay in std::iter::once(0u64).chain(BUSY_DELAYS_MS) {
            if delay > 0 {
                thread::sleep(Duration::from_millis(delay));
            }
            let connection = match Connection::open(&self.db_path) {
                Ok(connection) => connection,
                Err(error) => {
                    last_error = Some(error.to_string());
                    continue;
                }
            };
            if let Err(error) = connection_evidence(&connection) {
                return Err(error.to_string());
            }
            match operation(&connection) {
                Ok(value) => return Ok(value),
                Err(error) if is_busy(&error) => {
                    last_error = Some(error);
                }
                Err(error) => return Err(error),
            }
        }
        Err(format!(
            "metadata_busy: SQLite operation exceeded bounded retry window: {}",
            last_error.unwrap_or_else(|| "busy".to_string())
        ))
    }

    fn save_incremental(&self, collection: &Collection) -> Result<(), String> {
        let result =
            self.with_connection(|connection| save_incremental_connection(connection, collection));
        if result.is_ok() {
            self.migration
                .mark_first_canonical_mutation()
                .map_err(|error| error.to_string())?;
            crate::collection::manager::save_collection_to_path(&self.collections_dir, collection)?;
        }
        result
    }
}

impl CollectionRepository for SqliteMetadataRepository {
    fn get_all(&self) -> Result<Vec<Collection>, String> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare("SELECT id,name,created_at,updated_at,metadata_json FROM collections ORDER BY name_key,id").map_err(|error| error.to_string())?;
            let rows = statement.query_map([], collection_from_row).map_err(|error| error.to_string())?;
            let mut collections = Vec::new();
            for row in rows { let partial = row.map_err(|error| error.to_string())?; collections.push(read_collection_entries(connection, partial)?); }
            Ok(collections)
        })
    }

    fn load(&self, id: &str) -> Result<Collection, String> {
        self.with_connection(|connection| {
            let partial = connection.query_row("SELECT id,name,created_at,updated_at,metadata_json FROM collections WHERE id=?1", params![id], collection_from_row).map_err(|error| error.to_string())?;
            read_collection_entries(connection, partial)
        })
    }

    fn save(&self, collection: &Collection) -> Result<(), String> {
        self.save_incremental(collection)
    }

    fn delete(&self, id: &str) -> Result<(), String> {
        let result = self.with_connection(|connection| {
            connection
                .execute_batch("BEGIN IMMEDIATE")
                .map_err(|error| error.to_string())?;
            let result = connection
                .execute("DELETE FROM collections WHERE id=?1", params![id])
                .map_err(|error| error.to_string());
            if result.is_err() {
                let _ = connection.execute_batch("ROLLBACK");
                return result.map(|_| ());
            }
            connection
                .execute_batch("COMMIT")
                .map_err(|error| error.to_string())
        });
        if result.is_ok() {
            self.migration
                .mark_first_canonical_mutation()
                .map_err(|error| error.to_string())?;
        }
        result
    }

    fn add_entry(
        &self,
        collection_id: &str,
        parent_path: &[usize],
        entry: Entry,
    ) -> Result<(), String> {
        let mut collection = self.load(collection_id)?;
        group_at_path_mut(&mut collection.entries, parent_path)?.push(entry);
        collection.updated_at = now();
        self.save_incremental(&collection)
    }

    fn remove_entry(&self, collection_id: &str, entry_id: &str) -> Result<Entry, String> {
        let mut collection = self.load(collection_id)?;
        let (removed, found) = remove_recursive(&mut collection.entries, entry_id);
        if !found {
            return Err(format!("Entry with ID {} not found", entry_id));
        }
        collection.updated_at = now();
        self.save_incremental(&collection)?;
        Ok(removed.expect("found entry must be present"))
    }

    fn move_entry(
        &self,
        collection_id: &str,
        entry_id: &str,
        parent_path: &[usize],
        new_index: usize,
    ) -> Result<(), String> {
        let mut collection = self.load(collection_id)?;
        move_in_memory(&mut collection.entries, entry_id, parent_path, new_index)?;
        collection.updated_at = now();
        self.save_incremental(&collection)
    }

    fn delete_group_and_promote(&self, collection_id: &str, group_id: &str) -> Result<(), String> {
        let mut collection = self.load(collection_id)?;
        if !promote_group(&mut collection.entries, group_id) {
            return Err(format!("Group with ID {} not found", group_id));
        }
        collection.updated_at = now();
        self.save_incremental(&collection)
    }
}

impl MetadataRepository for SqliteMetadataRepository {
    fn apply_mutation(&self, request: MutationRequest) -> Result<MutationResult, SafetyError> {
        let request_for_db = request.clone();
        let result = self.with_connection(|connection| {
            connection.execute_batch("BEGIN IMMEDIATE").map_err(|error| error.to_string())?;
            let transaction_result = (|| {
                let prior: Option<(i64, String)> = connection.query_row("SELECT revision,result_json FROM mutation_records WHERE collection_id=?1 AND mutation_id=?2", params![request_for_db.collection_id, request_for_db.mutation_id], |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(|error| error.to_string())?;
                if let Some((revision, changes_json)) = prior {
                    let mut stored: MutationResult = serde_json::from_str(&changes_json).map_err(|error| format!("metadata_change_decode: {error}"))?;
                    stored.collection_id = request_for_db.collection_id.clone();
                    stored.revision = revision;
                    stored.mutation_id = request_for_db.mutation_id.clone();
                    stored.idempotent_replay = true;
                    return Ok(stored);
                }
                let current_revision: i64 = connection.query_row("SELECT revision FROM collections WHERE id=?1", params![request_for_db.collection_id], |row| row.get(0)).map_err(|error| format!("metadata_not_found: {error}"))?;
                if current_revision != request_for_db.expected_revision { return Err(format!("metadata_revision_conflict: expected {}, current {}", request_for_db.expected_revision, current_revision)); }
                let (changes, metrics) = apply_direct_mutation(connection, &request_for_db.collection_id, &request_for_db.operation, current_revision + 1)?;
                record_v2_mutation(connection, &request_for_db.collection_id, current_revision + 1, &request_for_db.mutation_id, changes, metrics)
            })();
            match transaction_result { Ok(value) => { connection.execute_batch("COMMIT").map_err(|error| error.to_string())?; Ok(value) }, Err(error) => { let _ = connection.execute_batch("ROLLBACK"); Err(error) } }
        }).map_err(metadata_error)?;
        if !result.idempotent_replay {
            self.migration.mark_first_canonical_mutation()?;
        }
        Ok(result)
    }

    fn migration_status(&self) -> Result<MigrationStatus, SafetyError> {
        self.migration.status()
    }

    fn retry_migration(&self) -> Result<MigrationStatus, SafetyError> {
        self.migration.migrate()?;
        self.migration.status()
    }

    fn snapshot(
        &self,
        collection_id: &str,
        cursor: crate::fs_layer::watcher::WatchCursor,
    ) -> Result<crate::metadata::MetadataSnapshot, SafetyError> {
        self.with_connection(|connection| {
            let partial = connection.query_row("SELECT id,name,created_at,updated_at,metadata_json FROM collections WHERE id=?1", params![collection_id], collection_from_row).map_err(|error| format!("metadata_not_found: {error}"))?;
            let collection = read_collection_entries(connection, partial)?;
            let revision: i64 = connection.query_row("SELECT revision FROM collections WHERE id=?1", params![collection_id], |row| row.get(0)).map_err(|error| error.to_string())?;
            Ok(crate::metadata::MetadataSnapshot { collection, revision, cursor: cursor.clone() })
        }).map_err(metadata_error)
    }
}

fn apply_direct_mutation(
    connection: &Connection,
    collection_id: &str,
    operation: &MutationOperation,
    source_revision: i64,
) -> Result<(serde_json::Value, MutationMetrics), String> {
    let rows = read_entry_rows(connection, collection_id)?;
    let mut metrics = MutationMetrics {
        query_count: 1,
        ..MutationMetrics::default()
    };
    let mut changes = Vec::new();
    match operation {
        MutationOperation::AddEntry { parent_path, entry } => {
            let parent_id = parent_for_path(&rows, collection_id, parent_path)?;
            let siblings = sibling_ids(&rows, collection_id, parent_id.as_deref());
            let id = entry_id(entry).to_string();
            if rows
                .iter()
                .any(|row| row.collection_id == collection_id && row.id == id)
            {
                return Err(format!("metadata_duplicate_entry_id: {id}"));
            }
            let new_row = entry_to_row(
                collection_id,
                parent_id.clone(),
                siblings.len() as i64,
                entry,
            )?;
            let link = entry_index_row(collection_id, entry);
            connection.execute("INSERT INTO entries(collection_id,id,parent_id,entry_type,name,path,sort_order) VALUES(?1,?2,?3,?4,?5,?6,?7)", params![new_row.collection_id,new_row.id,new_row.parent_id,new_row.entry_type,new_row.name,new_row.path,new_row.sort_order]).map_err(|error| error.to_string())?;
            metrics.changed_entry_rows = 1;
            if link.is_some() {
                metrics.changed_link_rows = 1;
            }
            changes.push(change_value(&id, None, Some(&new_row)));
            if let Some(index) = link {
                connection.execute("INSERT INTO link_index(collection_id,entry_id,display_name,path,entry_type,source_revision) VALUES(?1,?2,?3,?4,?5,?6)", params![index.collection_id,index.entry_id,index.display_name,index.path,index.entry_type,source_revision]).map_err(|error| error.to_string())?;
            }
        }
        MutationOperation::RemoveEntry { entry_id: id } => {
            let target = rows
                .iter()
                .find(|row| row.collection_id == collection_id && row.id == *id)
                .cloned()
                .ok_or_else(|| format!("metadata_entry_not_found: {id}"))?;
            let mut siblings = sibling_ids(&rows, collection_id, target.parent_id.as_deref());
            siblings.retain(|candidate| candidate != id);
            shift_siblings(connection, collection_id, target.parent_id.as_deref())?;
            for (sort_order, sibling) in siblings.iter().enumerate() {
                connection
                    .execute(
                        "UPDATE entries SET sort_order=?1 WHERE collection_id=?2 AND id=?3",
                        params![sort_order as i64 + ORDER_OFFSET, collection_id, sibling],
                    )
                    .map_err(|error| error.to_string())?;
            }
            restore_shifted(connection, collection_id)?;
            let subtree_links: i64 = connection.query_row("SELECT COUNT(*) FROM link_index WHERE collection_id=?1 AND entry_id IN (SELECT id FROM entries WHERE collection_id=?1 AND (id=?2 OR parent_id=?2))", params![collection_id,id], |row| row.get(0)).unwrap_or(0);
            metrics.changed_entry_rows = rows
                .iter()
                .filter(|row| {
                    row.collection_id == collection_id
                        && (row.id == *id || is_descendant(&rows, &row.id, id))
                })
                .count() as i64;
            metrics.changed_link_rows = subtree_links;
            connection
                .execute(
                    "DELETE FROM entries WHERE collection_id=?1 AND id=?2",
                    params![collection_id, id],
                )
                .map_err(|error| error.to_string())?;
            changes.push(change_value(id, Some(&target), None));
        }
        MutationOperation::MoveEntry {
            entry_id: id,
            parent_path,
            new_index,
        } => {
            let target = rows
                .iter()
                .find(|row| row.collection_id == collection_id && row.id == *id)
                .cloned()
                .ok_or_else(|| format!("metadata_entry_not_found: {id}"))?;
            let new_parent = parent_for_path(&rows, collection_id, parent_path)?;
            if new_parent.as_deref() == Some(id)
                || new_parent
                    .as_ref()
                    .is_some_and(|parent| is_descendant(&rows, parent, id))
            {
                return Err("metadata_invalid_move: cannot move entry into its descendant".into());
            }
            let old_order = target.sort_order;
            let effective_index =
                if new_parent == target.parent_id && (*new_index as i64) > old_order {
                    new_index.saturating_sub(1)
                } else {
                    *new_index
                } as i64;
            let old_parent = target.parent_id.clone();
            shift_siblings(connection, collection_id, old_parent.as_deref())?;
            if new_parent != old_parent {
                shift_siblings(connection, collection_id, new_parent.as_deref())?;
            }
            if new_parent == old_parent {
                if effective_index < old_order {
                    connection.execute("UPDATE entries SET sort_order=sort_order+1 WHERE collection_id=?1 AND parent_id IS ?2 AND sort_order>=?3 AND sort_order<?4 AND id<>?5", params![collection_id,new_parent,effective_index+ORDER_OFFSET*3,old_order+ORDER_OFFSET*3,id]).map_err(|error| error.to_string())?;
                } else if effective_index > old_order {
                    connection.execute("UPDATE entries SET sort_order=sort_order-1 WHERE collection_id=?1 AND parent_id IS ?2 AND sort_order>?3 AND sort_order<=?4 AND id<>?5", params![collection_id,new_parent,old_order+ORDER_OFFSET*3,effective_index+ORDER_OFFSET*3,id]).map_err(|error| error.to_string())?;
                }
            } else {
                connection.execute("UPDATE entries SET sort_order=sort_order-1 WHERE collection_id=?1 AND parent_id IS ?2 AND sort_order>?3 AND id<>?4", params![collection_id,old_parent,old_order+ORDER_OFFSET*3,id]).map_err(|error| error.to_string())?;
                connection.execute("UPDATE entries SET sort_order=sort_order+1 WHERE collection_id=?1 AND parent_id IS ?2 AND sort_order>=?3", params![collection_id,new_parent,effective_index+ORDER_OFFSET*3]).map_err(|error| error.to_string())?;
            }
            connection.execute("UPDATE entries SET parent_id=?1,sort_order=?2 WHERE collection_id=?3 AND id=?4", params![new_parent,effective_index+ORDER_OFFSET,collection_id,id]).map_err(|error| error.to_string())?;
            restore_shifted(connection, collection_id)?;
            metrics.changed_entry_rows = 1;
            changes.push(change_value(
                id,
                Some(&target),
                Some(&{
                    let mut after = target.clone();
                    after.parent_id = new_parent.clone();
                    after.sort_order = effective_index;
                    after
                }),
            ));
        }
        MutationOperation::RenameGroup { group_id, name } => {
            let target = rows
                .iter()
                .find(|row| {
                    row.collection_id == collection_id
                        && row.id == *group_id
                        && row.entry_type == "group"
                })
                .cloned()
                .ok_or_else(|| format!("metadata_group_not_found: {group_id}"))?;
            connection
                .execute(
                    "UPDATE entries SET name=?1 WHERE collection_id=?2 AND id=?3",
                    params![name, collection_id, group_id],
                )
                .map_err(|error| error.to_string())?;
            let mut after = target.clone();
            after.name = Some(name.clone());
            metrics.changed_entry_rows = 1;
            changes.push(change_value(group_id, Some(&target), Some(&after)));
        }
        MutationOperation::RelinkEntry { entry_id: id, path } => {
            let target = rows
                .iter()
                .find(|row| {
                    row.collection_id == collection_id && row.id == *id && row.entry_type != "group"
                })
                .cloned()
                .ok_or_else(|| format!("metadata_entry_not_found: {id}"))?;
            connection
                .execute(
                    "UPDATE entries SET path=?1 WHERE collection_id=?2 AND id=?3",
                    params![path, collection_id, id],
                )
                .map_err(|error| error.to_string())?;
            connection
                .execute(
                    "UPDATE link_index SET path=?1,source_revision=?4 WHERE collection_id=?2 AND entry_id=?3",
                    params![path, collection_id, id, source_revision],
                )
                .map_err(|error| error.to_string())?;
            let mut after = target.clone();
            after.path = Some(path.clone());
            metrics.changed_entry_rows = 1;
            metrics.changed_link_rows = 1;
            changes.push(change_value(id, Some(&target), Some(&after)));
        }
        MutationOperation::DeleteGroupAndPromote { group_id } => {
            let group = rows
                .iter()
                .find(|row| {
                    row.collection_id == collection_id
                        && row.id == *group_id
                        && row.entry_type == "group"
                })
                .cloned()
                .ok_or_else(|| format!("metadata_group_not_found: {group_id}"))?;
            let children = rows
                .iter()
                .filter(|row| {
                    row.collection_id == collection_id && row.parent_id.as_deref() == Some(group_id)
                })
                .cloned()
                .collect::<Vec<_>>();
            let index = group.sort_order;
            shift_siblings(connection, collection_id, group.parent_id.as_deref())?;
            shift_siblings(connection, collection_id, Some(group_id))?;
            if let Some(parent) = group.parent_id.as_deref() {
                connection.execute("UPDATE entries SET sort_order=sort_order-?1 WHERE collection_id=?2 AND parent_id=?3 AND sort_order<?4", params![ORDER_OFFSET*2,collection_id,parent,index+ORDER_OFFSET*3]).map_err(|error| error.to_string())?;
                connection.execute("UPDATE entries SET sort_order=sort_order-?1+?2 WHERE collection_id=?3 AND parent_id=?4 AND sort_order>?5 AND id<>?6", params![ORDER_OFFSET*2,children.len() as i64 - 1,collection_id,parent,index+ORDER_OFFSET*3,group_id]).map_err(|error| error.to_string())?;
                connection.execute("UPDATE entries SET parent_id=?1,sort_order=sort_order-?2+?3 WHERE collection_id=?4 AND parent_id=?5", params![parent,ORDER_OFFSET*2,index,collection_id,group_id]).map_err(|error| error.to_string())?;
            } else {
                connection.execute("UPDATE entries SET sort_order=sort_order-?1 WHERE collection_id=?2 AND parent_id IS NULL AND sort_order<?3", params![ORDER_OFFSET*2,collection_id,index+ORDER_OFFSET*3]).map_err(|error| error.to_string())?;
                connection.execute("UPDATE entries SET sort_order=sort_order-?1+?2 WHERE collection_id=?3 AND parent_id IS NULL AND sort_order>?4 AND id<>?5", params![ORDER_OFFSET*2,children.len() as i64 - 1,collection_id,index+ORDER_OFFSET*3,group_id]).map_err(|error| error.to_string())?;
                connection.execute("UPDATE entries SET parent_id=NULL,sort_order=sort_order-?1+?2 WHERE collection_id=?3 AND parent_id=?4", params![ORDER_OFFSET*2,index,collection_id,group_id]).map_err(|error| error.to_string())?;
            }
            connection
                .execute(
                    "DELETE FROM entries WHERE collection_id=?1 AND id=?2",
                    params![collection_id, group_id],
                )
                .map_err(|error| error.to_string())?;
            restore_shifted(connection, collection_id)?;
            metrics.changed_entry_rows = children.len() as i64 + 1;
            changes.push(change_value(group_id, Some(&group), None));
        }
    }
    Ok((serde_json::Value::Array(changes), metrics))
}

fn record_v2_mutation(
    connection: &Connection,
    collection_id: &str,
    revision: i64,
    mutation_id: &str,
    changes: serde_json::Value,
    metrics: MutationMetrics,
) -> Result<MutationResult, String> {
    let result = MutationResult {
        collection_id: collection_id.to_string(),
        revision,
        mutation_id: mutation_id.to_string(),
        changes: changes.clone(),
        idempotent_replay: false,
        metrics: metrics.clone(),
    };
    connection
        .execute(
            "UPDATE collections SET revision=?1 WHERE id=?2",
            params![revision, collection_id],
        )
        .map_err(|error| error.to_string())?;
    connection.execute("INSERT INTO collection_changes(collection_id,revision,mutation_id,changes_json,created_at) VALUES(?1,?2,?3,?4,?5)", params![collection_id,revision,mutation_id,serde_json::to_string(&changes).map_err(|error| error.to_string())?,now()]).map_err(|error| error.to_string())?;
    let min_available = revision.saturating_sub(UI_CHANGE_RETENTION_MAX - 1).max(0);
    connection.execute("INSERT INTO change_feed_state(collection_id,min_available_revision,current_revision,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(collection_id) DO UPDATE SET min_available_revision=excluded.min_available_revision,current_revision=excluded.current_revision,updated_at=excluded.updated_at", params![collection_id,min_available,revision,now()]).map_err(|error| error.to_string())?;
    let result_json = serde_json::to_string(&result).map_err(|error| error.to_string())?;
    connection.execute("INSERT INTO mutation_records(collection_id,mutation_id,revision,result_json,created_at) VALUES(?1,?2,?3,?4,?5)", params![collection_id,mutation_id,revision,result_json,now()]).map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM collection_changes WHERE collection_id=?1 AND revision < ?2",
            params![collection_id, min_available],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM mutation_records WHERE collection_id=?1 AND revision < ?2",
            params![
                collection_id,
                revision.saturating_sub(MUTATION_RETENTION_MAX - 1).max(0)
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(result)
}

fn parent_for_path(
    rows: &[LegacyEntryRow],
    collection_id: &str,
    path: &[usize],
) -> Result<Option<String>, String> {
    let mut parent = None;
    for index in path {
        let mut children = rows
            .iter()
            .filter(|row| row.collection_id == collection_id && row.parent_id == parent)
            .collect::<Vec<_>>();
        children.sort_by_key(|row| (row.sort_order, row.id.clone()));
        let Some(row) = children.get(*index) else {
            return Err("metadata_invalid_parent_path: path index out of bounds".into());
        };
        if row.entry_type != "group" {
            return Err("metadata_invalid_parent_path: parent is not a group".into());
        }
        parent = Some(row.id.clone());
    }
    Ok(parent)
}
fn sibling_ids(rows: &[LegacyEntryRow], collection_id: &str, parent: Option<&str>) -> Vec<String> {
    let mut siblings = rows
        .iter()
        .filter(|row| row.collection_id == collection_id && row.parent_id.as_deref() == parent)
        .collect::<Vec<_>>();
    siblings.sort_by_key(|row| (row.sort_order, row.id.clone()));
    siblings.into_iter().map(|row| row.id.clone()).collect()
}
fn entry_to_row(
    collection_id: &str,
    parent_id: Option<String>,
    sort_order: i64,
    entry: &Entry,
) -> Result<LegacyEntryRow, String> {
    match entry {
        Entry::File { id, path } => Ok(LegacyEntryRow {
            collection_id: collection_id.into(),
            id: id.clone(),
            parent_id,
            entry_type: "file".into(),
            name: None,
            path: Some(path.clone()),
            sort_order,
        }),
        Entry::FolderRef { id, path } => Ok(LegacyEntryRow {
            collection_id: collection_id.into(),
            id: id.clone(),
            parent_id,
            entry_type: "folder-ref".into(),
            name: None,
            path: Some(path.clone()),
            sort_order,
        }),
        Entry::Group { id, name, .. } => Ok(LegacyEntryRow {
            collection_id: collection_id.into(),
            id: id.clone(),
            parent_id,
            entry_type: "group".into(),
            name: Some(name.clone()),
            path: None,
            sort_order,
        }),
    }
}
fn entry_index_row(collection_id: &str, entry: &Entry) -> Option<crate::metadata::LegacyIndexRow> {
    match entry {
        Entry::File { id, path } => Some(crate::metadata::LegacyIndexRow {
            collection_id: collection_id.into(),
            entry_id: id.clone(),
            display_name: Path::new(path)
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or("")
                .to_string(),
            path: path.clone(),
            entry_type: "file".into(),
        }),
        Entry::FolderRef { id, path } => Some(crate::metadata::LegacyIndexRow {
            collection_id: collection_id.into(),
            entry_id: id.clone(),
            display_name: Path::new(path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("")
                .to_string(),
            path: path.clone(),
            entry_type: "folder-ref".into(),
        }),
        Entry::Group { .. } => None,
    }
}
fn shift_siblings(
    connection: &Connection,
    collection_id: &str,
    parent_id: Option<&str>,
) -> Result<(), String> {
    if let Some(parent_id) = parent_id {
        connection.execute("UPDATE entries SET sort_order=sort_order+?1 WHERE collection_id=?2 AND parent_id=?3", params![ORDER_OFFSET * 3,collection_id,parent_id]).map_err(|error| error.to_string())?;
    } else {
        connection.execute("UPDATE entries SET sort_order=sort_order+?1 WHERE collection_id=?2 AND parent_id IS NULL", params![ORDER_OFFSET * 3,collection_id]).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn restore_shifted(connection: &Connection, collection_id: &str) -> Result<(), String> {
    connection
        .execute(
            "UPDATE entries SET sort_order=sort_order-?1 WHERE collection_id=?2 AND sort_order>=?1",
            params![ORDER_OFFSET * 2, collection_id],
        )
        .map_err(|error| error.to_string())?;
    connection.execute("UPDATE entries SET sort_order=sort_order-?1 WHERE collection_id=?2 AND sort_order>=?1 AND sort_order<?3", params![ORDER_OFFSET,collection_id,ORDER_OFFSET * 2]).map_err(|error| error.to_string())?;
    Ok(())
}
fn is_descendant(rows: &[LegacyEntryRow], candidate: &str, ancestor: &str) -> bool {
    let mut current = rows
        .iter()
        .find(|row| row.id == candidate)
        .and_then(|row| row.parent_id.clone());
    while let Some(parent) = current {
        if parent == ancestor {
            return true;
        }
        current = rows
            .iter()
            .find(|row| row.id == parent)
            .and_then(|row| row.parent_id.clone());
    }
    false
}
fn save_incremental_connection(
    connection: &Connection,
    collection: &Collection,
) -> Result<(), String> {
    let (new_rows, new_index) =
        flatten_collection(collection).map_err(|error| error.to_string())?;
    connection
        .execute_batch("BEGIN IMMEDIATE")
        .map_err(|error| error.to_string())?;
    let result = (|| {
        let old_revision: Option<i64> = connection
            .query_row(
                "SELECT revision FROM collections WHERE id=?1",
                params![collection.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let revision = old_revision.unwrap_or(0) + 1;
        let old_rows = if old_revision.is_some() {
            read_entry_rows(connection, &collection.id)?
        } else {
            Vec::new()
        };
        connection.execute("INSERT INTO collections(id,name,name_key,created_at,updated_at,metadata_json,revision) VALUES(?1,?2,?3,?4,?5,?6,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,name_key=excluded.name_key,created_at=excluded.created_at,updated_at=excluded.updated_at,metadata_json=excluded.metadata_json", params![collection.id,collection.name,collection.name.to_lowercase(),collection.created_at,collection.updated_at,collection.metadata.as_ref().map(|value| serde_json::to_string(value).unwrap_or_else(|_| "null".to_string()))]).map_err(|error| error.to_string())?;
        let old_by_id: HashMap<String, LegacyEntryRow> = old_rows
            .iter()
            .cloned()
            .map(|row| (row.id.clone(), row))
            .collect();
        let new_by_id: HashMap<String, LegacyEntryRow> = new_rows
            .iter()
            .cloned()
            .map(|row| (row.id.clone(), row))
            .collect();
        let mut changed_ids = HashSet::new();
        for (id, old) in &old_by_id {
            if new_by_id.get(id) != Some(old) {
                changed_ids.insert(id.clone());
            }
        }
        for id in new_by_id.keys() {
            if !old_by_id.contains_key(id) {
                changed_ids.insert(id.clone());
            }
        }
        for id in old_by_id.keys() {
            if !new_by_id.contains_key(id) {
                changed_ids.insert(id.clone());
            }
        }
        if !old_rows.is_empty() {
            connection
                .execute(
                    "UPDATE entries SET sort_order=sort_order+?1 WHERE collection_id=?2",
                    params![ORDER_OFFSET * 3, collection.id],
                )
                .map_err(|error| error.to_string())?;
        }
        for row in old_rows
            .iter()
            .filter(|row| !new_by_id.contains_key(&row.id))
        {
            connection
                .execute(
                    "DELETE FROM entries WHERE collection_id=?1 AND id=?2",
                    params![row.collection_id, row.id],
                )
                .map_err(|error| error.to_string())?;
        }
        for row in &new_rows {
            connection.execute("INSERT INTO entries(collection_id,id,parent_id,entry_type,name,path,sort_order) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(collection_id,id) DO UPDATE SET parent_id=excluded.parent_id,entry_type=excluded.entry_type,name=excluded.name,path=excluded.path,sort_order=excluded.sort_order", params![row.collection_id,row.id,row.parent_id,row.entry_type,row.name,row.path,row.sort_order+ORDER_OFFSET]).map_err(|error| error.to_string())?;
        }
        connection.execute("UPDATE entries SET sort_order=sort_order-?1 WHERE collection_id=?2 AND sort_order>=?1 AND sort_order<?3", params![ORDER_OFFSET,collection.id,ORDER_OFFSET * 2]).map_err(|error| error.to_string())?;
        for id in &changed_ids {
            connection
                .execute(
                    "DELETE FROM link_index WHERE collection_id=?1 AND entry_id=?2",
                    params![collection.id, id],
                )
                .map_err(|error| error.to_string())?;
        }
        for row in &new_index {
            if changed_ids.contains(&row.entry_id) {
                connection.execute("INSERT INTO link_index(collection_id,entry_id,display_name,path,entry_type,source_revision) VALUES(?1,?2,?3,?4,?5,?6)", params![row.collection_id,row.entry_id,row.display_name,row.path,row.entry_type,revision]).map_err(|error| error.to_string())?;
            }
        }
        let changes: Vec<_> = changed_ids
            .iter()
            .map(|id| change_value(id, old_by_id.get(id), new_by_id.get(id)))
            .collect();
        let mutation_id = format!("legacy-save-{}-{}", collection.id, uuid::Uuid::new_v4());
        connection
            .execute(
                "UPDATE collections SET revision=?1 WHERE id=?2",
                params![revision, collection.id],
            )
            .map_err(|error| error.to_string())?;
        connection.execute("INSERT INTO collection_changes(collection_id,revision,mutation_id,changes_json,created_at) VALUES(?1,?2,?3,?4,?5)", params![collection.id,revision,mutation_id,serde_json::to_string(&changes).map_err(|error| error.to_string())?,now()]).map_err(|error| error.to_string())?;
        connection.execute("INSERT INTO change_feed_state(collection_id,min_available_revision,current_revision,updated_at) VALUES(?1,0,?2,?3) ON CONFLICT(collection_id) DO UPDATE SET current_revision=excluded.current_revision,updated_at=excluded.updated_at", params![collection.id,revision,now()]).map_err(|error| error.to_string())?;
        let result_json = json!({ "collectionId": collection.id, "revision": revision, "mutationId": mutation_id, "changes": changes, "idempotentReplay": false });
        connection.execute("INSERT INTO mutation_records(collection_id,mutation_id,revision,result_json,created_at) VALUES(?1,?2,?3,?4,?5)", params![collection.id,mutation_id,revision,serde_json::to_string(&result_json).map_err(|error| error.to_string())?,now()]).map_err(|error| error.to_string())?;
        connection
            .execute(
                "DELETE FROM collection_changes WHERE collection_id=?1 AND revision < ?2",
                params![
                    collection.id,
                    revision.saturating_sub(UI_CHANGE_RETENTION_MAX)
                ],
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "DELETE FROM mutation_records WHERE collection_id=?1 AND revision < ?2",
                params![
                    collection.id,
                    revision.saturating_sub(MUTATION_RETENTION_MAX)
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    })();
    match result {
        Ok(()) => connection
            .execute_batch("COMMIT")
            .map_err(|error| error.to_string()),
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

fn save_incremental_in_transaction(
    connection: &Connection,
    collection: &Collection,
    mutation_id: &str,
) -> Result<(i64, serde_json::Value), String> {
    let (new_rows, new_index) =
        flatten_collection(collection).map_err(|error| error.to_string())?;
    let old_revision: Option<i64> = connection
        .query_row(
            "SELECT revision FROM collections WHERE id=?1",
            params![collection.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let revision = old_revision.unwrap_or(0) + 1;
    let old_rows = if old_revision.is_some() {
        read_entry_rows(connection, &collection.id)?
    } else {
        Vec::new()
    };
    connection.execute("INSERT INTO collections(id,name,name_key,created_at,updated_at,metadata_json,revision) VALUES(?1,?2,?3,?4,?5,?6,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,name_key=excluded.name_key,created_at=excluded.created_at,updated_at=excluded.updated_at,metadata_json=excluded.metadata_json", params![collection.id,collection.name,collection.name.to_lowercase(),collection.created_at,collection.updated_at,collection.metadata.as_ref().map(|value| serde_json::to_string(value).unwrap_or_else(|_| "null".to_string()))]).map_err(|error| error.to_string())?;
    let old_by_id: HashMap<String, LegacyEntryRow> = old_rows
        .iter()
        .cloned()
        .map(|row| (row.id.clone(), row))
        .collect();
    let new_by_id: HashMap<String, LegacyEntryRow> = new_rows
        .iter()
        .cloned()
        .map(|row| (row.id.clone(), row))
        .collect();
    let changed_ids: HashSet<String> = old_by_id
        .keys()
        .chain(new_by_id.keys())
        .filter(|id| old_by_id.get(*id) != new_by_id.get(*id))
        .cloned()
        .collect();
    if !old_rows.is_empty() {
        connection
            .execute(
                "UPDATE entries SET sort_order=sort_order+?1 WHERE collection_id=?2",
                params![ORDER_OFFSET * 3, collection.id],
            )
            .map_err(|error| error.to_string())?;
    }
    for row in old_rows
        .iter()
        .filter(|row| !new_by_id.contains_key(&row.id))
    {
        connection
            .execute(
                "DELETE FROM entries WHERE collection_id=?1 AND id=?2",
                params![row.collection_id, row.id],
            )
            .map_err(|error| error.to_string())?;
    }
    for row in &new_rows {
        connection.execute("INSERT INTO entries(collection_id,id,parent_id,entry_type,name,path,sort_order) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(collection_id,id) DO UPDATE SET parent_id=excluded.parent_id,entry_type=excluded.entry_type,name=excluded.name,path=excluded.path,sort_order=excluded.sort_order", params![row.collection_id,row.id,row.parent_id,row.entry_type,row.name,row.path,row.sort_order+ORDER_OFFSET]).map_err(|error| error.to_string())?;
    }
    connection.execute("UPDATE entries SET sort_order=sort_order-?1 WHERE collection_id=?2 AND sort_order>=?1 AND sort_order<?3", params![ORDER_OFFSET,collection.id,ORDER_OFFSET * 2]).map_err(|error| error.to_string())?;
    for id in &changed_ids {
        connection
            .execute(
                "DELETE FROM link_index WHERE collection_id=?1 AND entry_id=?2",
                params![collection.id, id],
            )
            .map_err(|error| error.to_string())?;
    }
    for row in &new_index {
        if changed_ids.contains(&row.entry_id) {
            connection.execute("INSERT INTO link_index(collection_id,entry_id,display_name,path,entry_type,source_revision) VALUES(?1,?2,?3,?4,?5,?6)", params![row.collection_id,row.entry_id,row.display_name,row.path,row.entry_type,revision]).map_err(|error| error.to_string())?;
        }
    }
    let changes: Vec<_> = changed_ids
        .iter()
        .map(|id| change_value(id, old_by_id.get(id), new_by_id.get(id)))
        .collect();
    connection
        .execute(
            "UPDATE collections SET revision=?1 WHERE id=?2",
            params![revision, collection.id],
        )
        .map_err(|error| error.to_string())?;
    connection.execute("INSERT INTO collection_changes(collection_id,revision,mutation_id,changes_json,created_at) VALUES(?1,?2,?3,?4,?5)", params![collection.id,revision,mutation_id,serde_json::to_string(&changes).map_err(|error| error.to_string())?,now()]).map_err(|error| error.to_string())?;
    connection.execute("INSERT INTO change_feed_state(collection_id,min_available_revision,current_revision,updated_at) VALUES(?1,0,?2,?3) ON CONFLICT(collection_id) DO UPDATE SET current_revision=excluded.current_revision,updated_at=excluded.updated_at", params![collection.id,revision,now()]).map_err(|error| error.to_string())?;
    let result_json = json!({ "collectionId": collection.id, "revision": revision, "mutationId": mutation_id, "changes": changes, "idempotentReplay": false });
    connection.execute("INSERT INTO mutation_records(collection_id,mutation_id,revision,result_json,created_at) VALUES(?1,?2,?3,?4,?5)", params![collection.id,mutation_id,revision,serde_json::to_string(&result_json).map_err(|error| error.to_string())?,now()]).map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM collection_changes WHERE collection_id=?1 AND revision < ?2",
            params![
                collection.id,
                revision.saturating_sub(UI_CHANGE_RETENTION_MAX)
            ],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM mutation_records WHERE collection_id=?1 AND revision < ?2",
            params![
                collection.id,
                revision.saturating_sub(MUTATION_RETENTION_MAX)
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok((
        revision,
        serde_json::to_value(&changes).map_err(|error| error.to_string())?,
    ))
}

fn collection_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Collection> {
    let metadata_json: Option<String> = row.get(4)?;
    Ok(Collection {
        id: row.get(0)?,
        schema_version: 1,
        name: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
        entries: Vec::new(),
        metadata: metadata_json
            .and_then(|json| serde_json::from_str::<CollectionMetadata>(&json).ok()),
    })
}

fn read_collection_entries(
    connection: &Connection,
    mut collection: Collection,
) -> Result<Collection, String> {
    let rows = read_entry_rows(connection, &collection.id)?;
    collection.entries =
        reconstruct_entries(&rows, &collection.id).map_err(|error| error.to_string())?;
    Ok(collection)
}

fn read_entry_rows(
    connection: &Connection,
    collection_id: &str,
) -> Result<Vec<LegacyEntryRow>, String> {
    let mut statement = connection.prepare("SELECT collection_id,id,parent_id,entry_type,name,path,sort_order FROM entries WHERE collection_id=?1 ORDER BY id").map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![collection_id], |row| {
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
        .map_err(|error| error.to_string())?;
    rows.map(|row| row.map_err(|error| error.to_string()))
        .collect()
}

fn group_at_path_mut<'a>(
    entries: &'a mut Vec<Entry>,
    path: &[usize],
) -> Result<&'a mut Vec<Entry>, String> {
    let mut current = entries;
    for index in path {
        let Some(Entry::Group { children, .. }) = current.get_mut(*index) else {
            return Err("Path segment is not a Group".into());
        };
        current = children;
    }
    Ok(current)
}
fn remove_recursive(entries: &mut Vec<Entry>, target: &str) -> (Option<Entry>, bool) {
    for index in 0..entries.len() {
        let matches = entry_id(&entries[index]) == target;
        if matches {
            return (Some(entries.remove(index)), true);
        }
        if let Entry::Group { children, .. } = &mut entries[index] {
            let result = remove_recursive(children, target);
            if result.1 {
                return result;
            }
        }
    }
    (None, false)
}
fn entry_id(entry: &Entry) -> &str {
    match entry {
        Entry::File { id, .. } | Entry::FolderRef { id, .. } | Entry::Group { id, .. } => id,
    }
}
fn find_path(entries: &[Entry], target: &str) -> Option<Vec<usize>> {
    for (index, entry) in entries.iter().enumerate() {
        if entry_id(entry) == target {
            return Some(vec![index]);
        }
        if let Entry::Group { children, .. } = entry {
            if let Some(mut path) = find_path(children, target) {
                path.insert(0, index);
                return Some(path);
            }
        }
    }
    None
}
fn move_in_memory(
    entries: &mut Vec<Entry>,
    target: &str,
    parent_path: &[usize],
    new_index: usize,
) -> Result<(), String> {
    let old_path =
        find_path(entries, target).ok_or_else(|| format!("Entry with ID {} not found", target))?;
    if parent_path.starts_with(&old_path) {
        return Err("Cannot move a group into its own subgroup".into());
    }
    let mut adjusted_parent = parent_path.to_vec();
    let mut adjusted_index = new_index;
    if !old_path.is_empty() {
        let common = old_path.len().min(adjusted_parent.len());
        for index in 0..common {
            if old_path[index] != adjusted_parent[index] {
                if index == old_path.len() - 1 && old_path[index] < adjusted_parent[index] {
                    adjusted_parent[index] -= 1;
                }
                break;
            }
        }
        if old_path.len().saturating_sub(1) == adjusted_parent.len()
            && adjusted_index > old_path[old_path.len() - 1]
        {
            adjusted_index -= 1;
        }
    }
    let (removed, found) = remove_recursive(entries, target);
    if !found {
        return Err(format!("Entry with ID {} not found", target));
    }
    let list = group_at_path_mut(entries, &adjusted_parent)?;
    list.insert(adjusted_index.min(list.len()), removed.unwrap());
    Ok(())
}
fn promote_group(entries: &mut Vec<Entry>, group_id: &str) -> bool {
    let mut index = 0;
    while index < entries.len() {
        if let Entry::Group { id, .. } = &entries[index] {
            if id == group_id {
                if let Entry::Group { children, .. } = entries.remove(index) {
                    for (offset, child) in children.into_iter().enumerate() {
                        entries.insert(index + offset, child);
                    }
                    return true;
                }
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
fn change_value(
    id: &str,
    old: Option<&LegacyEntryRow>,
    new: Option<&LegacyEntryRow>,
) -> serde_json::Value {
    let kind = if old.is_some() && new.is_some() {
        "updated"
    } else if new.is_some() {
        "added"
    } else {
        "removed"
    };
    let mut value = json!({ "entryId": id, "kind": kind });
    if let Some(row) = new {
        value["entry"] = json!({ "id": row.id, "parentId": row.parent_id, "entryType": row.entry_type, "name": row.name, "path": row.path, "sortOrder": row.sort_order });
    }
    value
}
fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}
fn is_busy(error: &str) -> bool {
    error.to_ascii_lowercase().contains("busy") || error.to_ascii_lowercase().contains("locked")
}

fn metadata_error(error: String) -> SafetyError {
    if let Some((code, message)) = error.split_once(": ") {
        if code.starts_with("metadata_")
            || code == "snapshot_required"
            || code == "idempotency_expired"
        {
            return SafetyError::new(code, message);
        }
    }
    SafetyError::new("recoverable_transaction", error)
}

trait OptionalQuery<T> {
    fn optional(self) -> rusqlite::Result<Option<T>>;
}
impl<T> OptionalQuery<T> for rusqlite::Result<T> {
    fn optional(self) -> rusqlite::Result<Option<T>> {
        match self {
            Ok(value) => Ok(Some(value)),
            Err(SqliteError::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error),
        }
    }
}
