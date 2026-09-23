use serde_json::json;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::thread;
use std::time::Duration;
use tauri_app_lib::metadata::{
    load_authoritative_snapshot, reconstruct_entries, MigrationService, MigrationState,
    OwnerMarker, SCHEMA_VERSION,
};

fn collection_json(id: &str, name: &str, duplicate_entry_id: &str) -> serde_json::Value {
    json!({
        "id": id,
        "schemaVersion": 1,
        "name": name,
        "createdAt": "2026-08-22T00:00:00Z",
        "updatedAt": "2026-08-22T00:00:00Z",
        "entries": [
            {"type": "file", "id": duplicate_entry_id, "path": format!("C:/notes/{id}.md")},
            {"type": "group", "id": format!("{id}-group"), "name": "Nested", "children": [
                {"type": "folder-ref", "id": format!("{id}-folder"), "path": format!("C:/notes/{id}")}
            ]}
        ]
    })
}

fn write_fixture(root: &Path) {
    fs::create_dir_all(root).unwrap();
    fs::write(
        root.join("first.json"),
        serde_json::to_vec_pretty(&collection_json("first", "First", "same-entry")).unwrap(),
    )
    .unwrap();
    fs::write(
        root.join("second.json"),
        serde_json::to_vec_pretty(&collection_json("second", "Second", "same-entry")).unwrap(),
    )
    .unwrap();
    fs::write(root.join("link-index.db"), b"legacy index is preserved").unwrap();
}

#[test]
fn staged_migration_preserves_json_and_legacy_index_and_supports_composite_identity() {
    let temp = tempfile::tempdir().unwrap();
    write_fixture(temp.path());
    let service = MigrationService::new(temp.path());
    let result = service.migrate().unwrap();
    assert_eq!(result.state, MigrationState::Committed);
    assert!(!result.reused_existing);
    assert_eq!(result.parity.collection_count, 2);
    assert_eq!(result.parity.entry_count, 6);
    assert_eq!(result.parity.index_count, 4);
    assert_eq!(
        fs::read(temp.path().join("link-index.db")).unwrap(),
        b"legacy index is preserved"
    );
    assert!(temp.path().join("first.json").exists());
    assert!(temp.path().join("metadata-v1.sqlite").exists());
    assert!(temp.path().join("metadata-v1.state").exists());
    assert!(result.parity.wal_sidecars_clear);

    let connection = rusqlite::Connection::open(temp.path().join("metadata-v1.sqlite")).unwrap();
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM entries WHERE id = 'same-entry'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 2);
    let fk: i64 = connection
        .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
        .unwrap();
    assert_eq!(fk, 1);

    let repeated = service.migrate().unwrap();
    assert!(repeated.reused_existing);
    assert_eq!(repeated.target_digest, result.target_digest);
}

#[test]
fn migration_reconstructs_tree_and_never_falls_back_after_canonical_mutation() {
    let temp = tempfile::tempdir().unwrap();
    write_fixture(temp.path());
    let service = MigrationService::new(temp.path());
    service.migrate().unwrap();
    let snapshot = load_authoritative_snapshot(temp.path()).unwrap();
    let first = reconstruct_entries(&snapshot.entries, "first").unwrap();
    assert_eq!(first.len(), 2);
    service.mark_first_canonical_mutation().unwrap();
    let mut changed = collection_json("first", "First", "same-entry");
    changed["entries"][0]["path"] = json!("C:/notes/changed.md");
    fs::write(
        temp.path().join("first.json"),
        serde_json::to_vec_pretty(&changed).unwrap(),
    )
    .unwrap();
    let restarted = service.migrate().unwrap();
    assert!(restarted.reused_existing);
    assert_eq!(restarted.parity.source_digest, "canonical-only");
    service.ensure_canonical_integrity().unwrap();
}

#[test]
fn malformed_source_and_case_collision_fail_before_publish() {
    let malformed = tempfile::tempdir().unwrap();
    fs::write(malformed.path().join("broken.json"), b"not-json").unwrap();
    let error = MigrationService::new(malformed.path())
        .migrate()
        .unwrap_err();
    assert_eq!(error.code, "metadata_malformed");
    assert!(!malformed.path().join("metadata-v1.sqlite").exists());

    let collision = tempfile::tempdir().unwrap();
    fs::write(
        collision.path().join("one.json"),
        serde_json::to_vec(&collection_json("one", "Same", "a")).unwrap(),
    )
    .unwrap();
    fs::write(
        collision.path().join("two.json"),
        serde_json::to_vec(&collection_json("two", "same", "b")).unwrap(),
    )
    .unwrap();
    let error = MigrationService::new(collision.path())
        .migrate()
        .unwrap_err();
    assert_eq!(error.code, "metadata_name_collision");
    assert!(!collision.path().join("metadata-v1.sqlite").exists());
}

#[test]
fn active_create_new_lease_fails_closed_as_metadata_busy() {
    let temp = tempfile::tempdir().unwrap();
    write_fixture(temp.path());
    let service = MigrationService::new(temp.path());
    fs::create_dir_all(&service.paths().journal_root).unwrap();
    let owner = OwnerMarker {
        transaction_id: "other-process".into(),
        process_id: 999_999,
        owner: "test-owner".into(),
        schema_version: SCHEMA_VERSION,
        source_path: temp.path().to_string_lossy().into_owned(),
        target_path: service.paths().target_db.to_string_lossy().into_owned(),
    };
    fs::write(
        service.paths().journal_root.join("active-lease.json"),
        serde_json::to_vec(&owner).unwrap(),
    )
    .unwrap();
    let error = service.migrate().unwrap_err();
    assert_eq!(error.code, "metadata_busy");
    assert!(!service.paths().target_db.exists());
}

#[test]
fn volume_capability_reports_device_identity_and_fails_closed_when_unavailable() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("stage.sqlite");
    fs::write(&source, b"stage").unwrap();
    let capability = MigrationService::new(temp.path())
        .volume_capability(&source, &temp.path().join("target.sqlite"));
    assert!(!capability.detection.is_empty());
    assert!(capability.same_volume == capability.destructive_rename_allowed);
}

#[test]
fn multiprocess_create_new_lease_fails_closed() {
    if let Ok(root) = std::env::var("PHASE3_LEASE_PROBE_ROOT") {
        let temp = std::path::PathBuf::from(root);
        let service = MigrationService::new(&temp);
        fs::create_dir_all(&service.paths().journal_root).unwrap();
        let owner = OwnerMarker {
            transaction_id: "child-process".into(),
            process_id: std::process::id(),
            owner: "phase3-child".into(),
            schema_version: SCHEMA_VERSION,
            source_path: temp.to_string_lossy().into_owned(),
            target_path: service.paths().target_db.to_string_lossy().into_owned(),
        };
        fs::write(
            service.paths().journal_root.join("active-lease.json"),
            serde_json::to_vec(&owner).unwrap(),
        )
        .unwrap();
        thread::sleep(Duration::from_millis(1_000));
        return;
    }
    let temp = tempfile::tempdir().unwrap();
    write_fixture(temp.path());
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "multiprocess_create_new_lease_fails_closed",
            "--nocapture",
        ])
        .env("PHASE3_LEASE_PROBE_ROOT", temp.path())
        .spawn()
        .unwrap();
    let lease = MigrationService::new(temp.path())
        .paths()
        .journal_root
        .join("active-lease.json");
    for _ in 0..50 {
        if lease.exists() {
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }
    let error = MigrationService::new(temp.path()).migrate().unwrap_err();
    assert_eq!(error.code, "metadata_busy");
    assert!(child.wait().unwrap().success());
}

#[test]
fn migration_profiles_cover_one_one_thousand_and_ten_thousand_entries_and_depths() {
    for count in [1usize, 1_000, 10_000] {
        let temp = tempfile::tempdir().unwrap();
        let mut entries = Vec::with_capacity(count + 1);
        for index in 0..count {
            entries.push(json!({"type":"file","id":format!("entry-{index}"),"path":format!("C:/notes/{index}.md")}));
        }
        entries.push(deep_group(8, "depth"));
        let value = json!({"id":"profile","schemaVersion":1,"name":format!("Profile {count}"),"createdAt":"2026-08-22T00:00:00Z","updatedAt":"2026-08-22T00:00:00Z","entries":entries});
        fs::write(
            temp.path().join("profile.json"),
            serde_json::to_vec(&value).unwrap(),
        )
        .unwrap();
        let result = MigrationService::new(temp.path()).migrate().unwrap();
        assert_eq!(result.parity.collection_count, 1);
        assert_eq!(result.parity.entry_count, count + 9);
        assert_eq!(
            MigrationService::new(temp.path())
                .migrate()
                .unwrap()
                .target_digest,
            result.target_digest
        );
    }
}

fn deep_group(depth: usize, prefix: &str) -> serde_json::Value {
    if depth == 0 {
        return json!({"type":"file","id":format!("{prefix}-leaf"),"path":"C:/notes/depth.md"});
    }
    json!({"type":"group","id":format!("{prefix}-{depth}"),"name":format!("Depth {depth}"),"children":[deep_group(depth - 1, prefix)]})
}
