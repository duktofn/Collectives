use serde_json::json;
use std::fs;
use tauri_app_lib::collection::{Collection, Entry};
use tauri_app_lib::metadata::{
    MigrationService, SqliteMetadataRepository, MUTATION_RETENTION_MAX, UI_CHANGE_RETENTION_MAX,
};
use tauri_app_lib::metadata::{MutationOperation, MutationRequest};
use tauri_app_lib::repositories::ports::{CollectionRepository, MetadataRepository};

fn collection(id: &str, name: &str) -> Collection {
    Collection {
        id: id.into(),
        schema_version: 1,
        name: name.into(),
        created_at: "2026-08-22T00:00:00Z".into(),
        updated_at: "2026-08-22T00:00:00Z".into(),
        entries: vec![
            Entry::File {
                id: "shared-entry".into(),
                path: format!("C:/notes/{id}.md"),
            },
            Entry::Group {
                id: format!("{id}-group"),
                name: "Group".into(),
                children: vec![Entry::File {
                    id: format!("{id}-nested"),
                    path: format!("C:/notes/{id}-nested.md"),
                }],
            },
        ],
        metadata: None,
    }
}

#[test]
fn mutations_are_composite_identity_and_incremental_change_envelopes() {
    let temp = tempfile::tempdir().unwrap();
    MigrationService::new(temp.path()).migrate().unwrap();
    let repository = SqliteMetadataRepository::new(temp.path());
    repository.save(&collection("one", "One")).unwrap();
    repository.save(&collection("two", "Two")).unwrap();
    assert_eq!(repository.get_all().unwrap().len(), 2);
    assert_eq!(repository.load("one").unwrap().entries.len(), 2);

    repository
        .add_entry(
            "one",
            &[],
            Entry::File {
                id: "added".into(),
                path: "C:/notes/added.md".into(),
            },
        )
        .unwrap();
    repository.move_entry("one", "added", &[], 0).unwrap();
    let removed = repository.remove_entry("one", "added").unwrap();
    assert_eq!(removed.id(), "added");
    repository
        .delete_group_and_promote("one", "one-group")
        .unwrap();

    let connection = rusqlite::Connection::open(temp.path().join("metadata-v1.sqlite")).unwrap();
    let composite_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM entries WHERE id='shared-entry'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(composite_count, 2);
    let revision: i64 = connection
        .query_row(
            "SELECT revision FROM collections WHERE id='one'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(revision >= 5);
    let changes: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM collection_changes WHERE collection_id='one'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(changes, revision);
    let delta: String = connection.query_row("SELECT changes_json FROM collection_changes WHERE collection_id='one' ORDER BY revision DESC LIMIT 1", [], |row| row.get(0)).unwrap();
    let value: serde_json::Value = serde_json::from_str(&delta).unwrap();
    assert!(value.is_array());
    assert!(connection.query_row::<i64, _, _>("SELECT COUNT(*) FROM link_index WHERE collection_id='one' AND entry_id='one-nested'", [], |row| row.get(0)).unwrap() == 1);
}

#[test]
fn sqlite_canonical_restart_ignores_stale_json_backup() {
    let temp = tempfile::tempdir().unwrap();
    MigrationService::new(temp.path()).migrate().unwrap();
    let repository = SqliteMetadataRepository::new(temp.path());
    repository.save(&collection("one", "One")).unwrap();
    fs::write(
        temp.path().join("one.json"),
        serde_json::to_vec(&json!({"not":"authoritative"})).unwrap(),
    )
    .unwrap();
    let result = MigrationService::new(temp.path()).migrate().unwrap();
    assert!(result.reused_existing);
    assert_eq!(repository.load("one").unwrap().id, "one");
}

#[test]
fn v2_mutation_idempotency_precedes_revision_conflict() {
    let temp = tempfile::tempdir().unwrap();
    MigrationService::new(temp.path()).migrate().unwrap();
    let repository = SqliteMetadataRepository::new(temp.path());
    repository.save(&collection("one", "One")).unwrap();
    let request = MutationRequest {
        collection_id: "one".into(),
        expected_revision: 1,
        mutation_id: "intent-1".into(),
        operation: MutationOperation::AddEntry {
            parent_path: vec![],
            entry: Entry::File {
                id: "v2-entry".into(),
                path: "C:/notes/v2.md".into(),
            },
        },
    };
    let first = repository.apply_mutation(request.clone()).unwrap();
    assert_eq!(first.revision, 2);
    assert!(!first.idempotent_replay);
    let replay = repository.apply_mutation(request).unwrap();
    assert!(replay.idempotent_replay);
    assert_eq!(replay.revision, 2);
    let conflict = repository
        .apply_mutation(MutationRequest {
            collection_id: "one".into(),
            expected_revision: 1,
            mutation_id: "intent-2".into(),
            operation: MutationOperation::RenameGroup {
                group_id: "one-group".into(),
                name: "new".into(),
            },
        })
        .unwrap_err();
    assert_eq!(conflict.code, "metadata_revision_conflict");
}

#[test]
fn canonical_queries_use_composite_and_feed_indexes() {
    let temp = tempfile::tempdir().unwrap();
    MigrationService::new(temp.path()).migrate().unwrap();
    let repository = SqliteMetadataRepository::new(temp.path());
    repository.save(&collection("one", "One")).unwrap();
    let connection = rusqlite::Connection::open(temp.path().join("metadata-v1.sqlite")).unwrap();
    let root_plan: String = connection.query_row("EXPLAIN QUERY PLAN SELECT id FROM entries WHERE collection_id='one' AND parent_id IS NULL ORDER BY sort_order,id", [], |row| row.get(3)).unwrap();
    let link_plan: String = connection.query_row("EXPLAIN QUERY PLAN SELECT entry_id FROM link_index WHERE collection_id='one' AND display_name LIKE '%shared%' COLLATE NOCASE", [], |row| row.get(3)).unwrap();
    assert!(
        root_plan.contains("entries_root_order") || root_plan.contains("entries_parent_lookup")
    );
    assert!(link_plan.contains("link_index_display_name") || link_plan.contains("collection_id"));
}

#[test]
fn v2_operations_report_affected_rows_without_full_rebuild() {
    let temp = tempfile::tempdir().unwrap();
    MigrationService::new(temp.path()).migrate().unwrap();
    let repository = SqliteMetadataRepository::new(temp.path());
    repository.save(&collection("one", "One")).unwrap();
    let operations = [
        MutationOperation::AddEntry {
            parent_path: vec![],
            entry: Entry::File {
                id: "added".into(),
                path: "C:/notes/added.md".into(),
            },
        },
        MutationOperation::RelinkEntry {
            entry_id: "shared-entry".into(),
            path: "C:/notes/relinked.md".into(),
        },
        MutationOperation::MoveEntry {
            entry_id: "added".into(),
            parent_path: vec![1],
            new_index: 0,
        },
        MutationOperation::RenameGroup {
            group_id: "one-group".into(),
            name: "Renamed".into(),
        },
        MutationOperation::DeleteGroupAndPromote {
            group_id: "one-group".into(),
        },
    ];
    for (offset, operation) in operations.into_iter().enumerate() {
        let result = repository
            .apply_mutation(MutationRequest {
                collection_id: "one".into(),
                expected_revision: offset as i64 + 1,
                mutation_id: format!("op-{offset}"),
                operation,
            })
            .unwrap();
        assert!(!result.metrics.full_rebuild);
        assert!(result.metrics.changed_entry_rows <= 4);
        assert!(result.metrics.query_count < 20);
    }
    let final_collection = repository.load("one").unwrap();
    let ids: Vec<&str> = final_collection
        .entries
        .iter()
        .map(|entry| entry.id())
        .collect();
    assert_eq!(ids, vec!["shared-entry", "added", "one-nested"]);
}

#[test]
fn change_feed_retention_requires_one_snapshot_fallback_and_expired_id_cannot_reapply() {
    assert_eq!(MUTATION_RETENTION_MAX, 50_000);
    assert_eq!(UI_CHANGE_RETENTION_MAX, 10_000);
    let temp = tempfile::tempdir().unwrap();
    MigrationService::new(temp.path()).migrate().unwrap();
    let repository = SqliteMetadataRepository::new(temp.path());
    repository.save(&collection("one", "One")).unwrap();
    let request = MutationRequest {
        collection_id: "one".into(),
        expected_revision: 1,
        mutation_id: "retained".into(),
        operation: MutationOperation::AddEntry {
            parent_path: vec![],
            entry: Entry::File {
                id: "retained-entry".into(),
                path: "C:/notes/retained.md".into(),
            },
        },
    };
    repository.apply_mutation(request.clone()).unwrap();
    let connection = rusqlite::Connection::open(temp.path().join("metadata-v1.sqlite")).unwrap();
    connection
        .execute(
            "DELETE FROM mutation_records WHERE collection_id='one' AND mutation_id='retained'",
            [],
        )
        .unwrap();
    connection
        .execute(
            "DELETE FROM collection_changes WHERE collection_id='one' AND revision=1",
            [],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE change_feed_state SET min_available_revision=2 WHERE collection_id='one'",
            [],
        )
        .unwrap();
    let snapshot = repository.read_changes_since("one", 0).unwrap_err();
    assert_eq!(snapshot.code, "snapshot_required");
    let page = repository.read_changes_since("one", 1).unwrap();
    assert_eq!(page.min_available_revision, 2);
    let expired = repository.apply_mutation(request).unwrap_err();
    assert_eq!(expired.code, "metadata_revision_conflict");
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM entries WHERE collection_id='one' AND id='retained-entry'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

trait EntryId {
    fn id(&self) -> &str;
}
impl EntryId for Entry {
    fn id(&self) -> &str {
        match self {
            Entry::File { id, .. } | Entry::FolderRef { id, .. } | Entry::Group { id, .. } => id,
        }
    }
}
