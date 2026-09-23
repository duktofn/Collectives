use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::io::Write;
use tauri_app_lib::collection::{archive, import_transaction, manager, Collection, Entry};
use tauri_app_lib::repositories::documents;
use tauri_app_lib::safety_error::SafetyError;
use tauri_app_lib::settings::Settings;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

fn collection_with_group() -> Collection {
    Collection {
        id: "collection-phase1".to_string(),
        schema_version: 1,
        name: "Phase 1".to_string(),
        created_at: "2026-01-01T00:00:00Z".to_string(),
        updated_at: "2026-01-01T00:00:00Z".to_string(),
        entries: vec![
            Entry::File {
                id: "before".to_string(),
                path: "before.md".to_string(),
            },
            Entry::Group {
                id: "group".to_string(),
                name: "Group".to_string(),
                children: vec![
                    Entry::File {
                        id: "child-a".to_string(),
                        path: "a.md".to_string(),
                    },
                    Entry::File {
                        id: "child-b".to_string(),
                        path: "b.md".to_string(),
                    },
                ],
            },
            Entry::File {
                id: "after".to_string(),
                path: "after.md".to_string(),
            },
        ],
        metadata: None,
    }
}

fn valid_zip(path: &std::path::Path, entry_path: &str) {
    let file = fs::File::create(path).unwrap();
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default();
    let manifest = serde_json::json!({
        "id": "zip-collection",
        "schemaVersion": 1,
        "name": "Zip Collection",
        "createdAt": "2026-01-01T00:00:00Z",
        "updatedAt": "2026-01-01T00:00:00Z",
        "entries": [{"type": "file", "id": "note", "path": entry_path}],
        "metadata": null
    });
    zip.start_file("manifest.json", options).unwrap();
    zip.write_all(serde_json::to_string(&manifest).unwrap().as_bytes())
        .unwrap();
    zip.start_file("assets/note.md", options).unwrap();
    zip.write_all(b"# note").unwrap();
    zip.finish().unwrap();
}

#[test]
fn safety_error_is_serializable_command_contract() {
    let error = SafetyError::new("external_change_conflict", "draft retained")
        .with_details(serde_json::json!({"path": "note.md"}));
    let value = serde_json::to_value(&error).unwrap();
    assert_eq!(value["code"], "external_change_conflict");
    assert_eq!(value["message"], "draft retained");
    assert_eq!(value["details"]["path"], "note.md");
}

#[test]
fn delete_group_promotes_children_in_order_atomically() {
    let temp = tempfile::tempdir().unwrap();
    let collection = collection_with_group();
    manager::save_collection_to_path(temp.path(), &collection).unwrap();
    manager::delete_group_and_promote_to_collection_path(temp.path(), &collection.id, "group")
        .unwrap();
    let loaded = manager::load_collection_from_path(temp.path(), &collection.id).unwrap();
    let ids: Vec<String> = loaded
        .entries
        .iter()
        .map(|entry| match entry {
            Entry::File { id, .. } => id.clone(),
            _ => "unexpected".to_string(),
        })
        .collect();
    assert_eq!(ids, vec!["before", "child-a", "child-b", "after"]);
}

#[test]
fn archive_rejects_traversal_before_import() {
    let temp = tempfile::tempdir().unwrap();
    let zip_path = temp.path().join("unsafe.zip");
    valid_zip(&zip_path, "assets/../escape.md");
    let error = archive::check_zip_conflicts(&zip_path, &temp.path().join("dest")).unwrap_err();
    assert!(error.contains("invalid_archive_member"));
}

#[test]
fn archive_requires_resolution_for_existing_destination() {
    let temp = tempfile::tempdir().unwrap();
    let zip_path = temp.path().join("safe.zip");
    valid_zip(&zip_path, "assets/note.md");
    let destination = temp.path().join("dest");
    fs::create_dir_all(&destination).unwrap();
    fs::write(destination.join("note.md"), b"local").unwrap();
    let conflicts = archive::check_zip_conflicts(&zip_path, &destination).unwrap();
    assert_eq!(conflicts.len(), 1);
    let error =
        archive::import_zip(temp.path(), &zip_path, &destination, HashMap::new()).unwrap_err();
    assert!(error.contains("unresolved_conflict"));
}

#[test]
fn color_body_canonical_and_legacy_alias_roundtrip() {
    let settings = Settings {
        color_body: Some("#123456".to_string()),
        ..Default::default()
    };
    let canonical = serde_json::to_value(&settings).unwrap();
    assert_eq!(canonical["colorBody"], "#123456");
    let legacy: Settings = serde_json::from_value(serde_json::json!({
        "theme": "dark", "fontScale": 1.0, "color_body": "#abcdef"
    }))
    .unwrap();
    assert_eq!(legacy.color_body.as_deref(), Some("#abcdef"));
}

#[test]
fn planned_transaction_recovery_is_scoped_and_persisted() {
    let temp = tempfile::tempdir().unwrap();
    let journal = import_transaction::create_journal(
        temp.path(),
        &temp.path().join("dest"),
        vec!["write".to_string()],
        None,
    )
    .unwrap();
    assert!(import_transaction::transaction_root(temp.path())
        .join(&journal.transaction_id)
        .join("journal.json")
        .exists());
    import_transaction::recover(temp.path()).unwrap();
    let persisted = fs::read_to_string(
        import_transaction::transaction_root(temp.path())
            .join(&journal.transaction_id)
            .join("journal.json"),
    )
    .unwrap();
    assert!(persisted.contains("rolled_back"));
}

#[test]
fn recovery_rejects_tampered_stage_ownership() {
    let temp = tempfile::tempdir().unwrap();
    let journal =
        import_transaction::create_journal(temp.path(), &temp.path().join("dest"), vec![], None)
            .unwrap();
    let journal_path = import_transaction::transaction_root(temp.path())
        .join(&journal.transaction_id)
        .join("journal.json");
    let mut value: serde_json::Value =
        serde_json::from_slice(&fs::read(&journal_path).unwrap()).unwrap();
    value["stage_root"] = serde_json::Value::String(
        temp.path()
            .join("outside-stage")
            .to_string_lossy()
            .into_owned(),
    );
    fs::write(&journal_path, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
    let error = import_transaction::recover(temp.path()).unwrap_err();
    assert_eq!(error.code, "recoverable_transaction");
}

#[test]
fn export_missing_source_preserves_existing_zip_digest() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("note.md");
    fs::write(&source, b"source").unwrap();
    let collection = Collection {
        entries: vec![Entry::File {
            id: "note".into(),
            path: source.to_string_lossy().into_owned(),
        }],
        ..collection_with_group()
    };
    manager::save_collection_to_path(temp.path(), &collection).unwrap();
    let output = temp.path().join("out.zip");
    archive::export_to_zip(temp.path(), &collection.id, &output).unwrap();
    let before = fs::read(&output).unwrap();
    fs::remove_file(&source).unwrap();
    assert!(archive::export_to_zip(temp.path(), &collection.id, &output)
        .unwrap_err()
        .contains("source_missing"));
    assert_eq!(fs::read(&output).unwrap(), before);
}

#[test]
fn folder_export_publishes_child_and_preserves_existing_target() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("note.md");
    fs::write(&source, b"source").unwrap();
    let collection = Collection {
        entries: vec![Entry::File {
            id: "note".into(),
            path: source.to_string_lossy().into_owned(),
        }],
        ..collection_with_group()
    };
    manager::save_collection_to_path(temp.path(), &collection).unwrap();
    let target = temp.path().join("parent").join("child");
    archive::export_to_folder(temp.path(), &collection.id, &target).unwrap();
    let digest = fs::read(target.join("note.md")).unwrap();
    assert_eq!(digest, b"source");
    assert!(
        archive::export_to_folder(temp.path(), &collection.id, &target)
            .unwrap_err()
            .contains("duplicate_destination")
    );
    assert_eq!(fs::read(target.join("note.md")).unwrap(), b"source");
}

#[test]
fn committed_import_publishes_assets_and_metadata() {
    let temp = tempfile::tempdir().unwrap();
    let zip_path = temp.path().join("safe.zip");
    valid_zip(&zip_path, "assets/note.md");
    let destination = temp.path().join("dest");
    let imported =
        archive::import_zip(temp.path(), &zip_path, &destination, HashMap::new()).unwrap();
    assert_eq!(fs::read(destination.join("note.md")).unwrap(), b"# note");
    let metadata = temp.path().join(format!("{}.json", imported.id));
    let mut text = String::new();
    fs::File::open(metadata)
        .unwrap()
        .read_to_string(&mut text)
        .unwrap();
    assert!(text.contains("Zip Collection"));
}

#[test]
fn import_overwrite_is_staged_and_preserves_unrelated_destination_digest() {
    let temp = tempfile::tempdir().unwrap();
    let zip_path = temp.path().join("safe.zip");
    valid_zip(&zip_path, "assets/note.md");
    let destination = temp.path().join("dest");
    fs::create_dir_all(&destination).unwrap();
    fs::write(destination.join("note.md"), b"local-old").unwrap();
    fs::write(destination.join("keep.md"), b"keep").unwrap();
    let keep_before = import_transaction::path_digest(&destination.join("keep.md")).unwrap();
    let imported = archive::import_zip(
        temp.path(),
        &zip_path,
        &destination,
        HashMap::from([(String::from("note"), String::from("overwrite"))]),
    )
    .unwrap();
    assert_eq!(fs::read(destination.join("note.md")).unwrap(), b"# note");
    assert_eq!(
        import_transaction::path_digest(&destination.join("keep.md")).unwrap(),
        keep_before
    );
    assert!(temp.path().join(format!("{}.json", imported.id)).exists());
}

#[test]
fn conditional_write_rejects_external_change_without_replacing_draft_target() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("note.md");
    fs::write(&path, b"before").unwrap();
    let snapshot = documents::read_file(path.to_string_lossy().into_owned()).unwrap();
    fs::write(&path, b"outside").unwrap();
    let error = documents::write_file(
        path.to_string_lossy().into_owned(),
        "draft".into(),
        Some(snapshot.version_token),
    )
    .unwrap_err();
    assert_eq!(error.code, "external_change_conflict");
    assert_eq!(fs::read(&path).unwrap(), b"outside");
}

#[test]
fn recovery_restores_persisted_backup_before_unblocking() {
    let temp = tempfile::tempdir().unwrap();
    let original = temp.path().join("original.txt");
    fs::write(&original, b"before").unwrap();
    let journal = import_transaction::create_journal(
        temp.path(),
        &original,
        vec!["replace".into()],
        Some(&original),
    )
    .unwrap();
    let root = import_transaction::transaction_root(temp.path()).join(&journal.transaction_id);
    let backup = root.join("backup.txt");
    fs::write(&backup, b"before").unwrap();
    let mut journal = journal;
    import_transaction::add_backup(&root, &mut journal, &original, &backup, None, None).unwrap();
    fs::write(&original, b"after").unwrap();
    import_transaction::transition(
        &root,
        &mut journal,
        import_transaction::TransactionState::MetadataCommitting,
    )
    .unwrap();
    import_transaction::recover(temp.path()).unwrap();
    assert_eq!(fs::read(&original).unwrap(), b"before");
}

#[test]
fn cross_volume_capability_is_recorded_and_safe() {
    let temp = tempfile::tempdir().unwrap();
    let expected_cross_volume = cfg!(windows) && std::path::Path::new("Z:\\").exists();
    let destination = if expected_cross_volume {
        if std::path::Path::new("Z:\\").exists() {
            std::path::PathBuf::from("Z:\\phase1-destination")
        } else {
            temp.path().join("destination")
        }
    } else {
        temp.path().join("destination")
    };
    let journal =
        import_transaction::create_journal(temp.path(), &destination, vec![], None).unwrap();
    assert!(!journal.fsync_capability.is_empty());
    if expected_cross_volume {
        assert!(journal.cross_volume);
    }
}

#[test]
fn persisted_assets_and_metadata_states_restore_before_metadata_split() {
    for state in [
        import_transaction::TransactionState::AssetsCommitting,
        import_transaction::TransactionState::MetadataCommitting,
    ] {
        let temp = tempfile::tempdir().unwrap();
        let destination = temp.path().join("destination");
        fs::create_dir_all(&destination).unwrap();
        let original = destination.join("note.md");
        fs::write(&original, b"before").unwrap();
        let journal = import_transaction::create_journal(
            temp.path(),
            &destination,
            vec!["assets".into(), "metadata".into()],
            None,
        )
        .unwrap();
        let root = import_transaction::transaction_root(temp.path()).join(&journal.transaction_id);
        let backup = root.join("backup").join("note.md");
        fs::create_dir_all(backup.parent().unwrap()).unwrap();
        fs::write(&backup, b"before").unwrap();
        let mut journal = journal;
        import_transaction::add_backup(
            &root,
            &mut journal,
            &original,
            &backup,
            Some(import_transaction::path_digest(&original).unwrap()),
            Some(blake3::hash(b"after").to_hex().to_string()),
        )
        .unwrap();
        fs::write(&original, b"after").unwrap();
        import_transaction::set_operation_status(&root, &mut journal, "assets", "published")
            .unwrap();
        import_transaction::transition(&root, &mut journal, state).unwrap();
        import_transaction::recover(temp.path()).unwrap();
        assert_eq!(fs::read(&original).unwrap(), b"before");
        let saved: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join("journal.json")).unwrap()).unwrap();
        assert_eq!(saved["state"], "rolled_back");
        assert_eq!(
            saved["operation_status"]["recovery"],
            "rolled-back-after-commit-failure"
        );
    }
}

#[test]
fn new_output_recovery_removes_only_digest_owned_publication() {
    let temp = tempfile::tempdir().unwrap();
    let output = temp.path().join("output");
    let journal =
        import_transaction::create_journal(temp.path(), &output, vec!["output".into()], None)
            .unwrap();
    let root = import_transaction::transaction_root(temp.path()).join(&journal.transaction_id);
    let mut journal = journal;
    import_transaction::add_backup(
        &root,
        &mut journal,
        &output,
        &root.join("backup").join("output"),
        None,
        Some(
            blake3::hash(b"published-by-transaction")
                .to_hex()
                .to_string(),
        ),
    )
    .unwrap();
    fs::write(&output, b"published-by-transaction").unwrap();
    import_transaction::transition(
        &root,
        &mut journal,
        import_transaction::TransactionState::AssetsCommitting,
    )
    .unwrap();
    import_transaction::recover(temp.path()).unwrap();
    assert!(!output.exists());
}

#[test]
fn rollback_pending_is_preserved_and_blocks_mutation() {
    let temp = tempfile::tempdir().unwrap();
    let journal = import_transaction::create_journal(
        temp.path(),
        &temp.path().join("dest"),
        vec!["fault".into()],
        None,
    )
    .unwrap();
    let root = import_transaction::transaction_root(temp.path()).join(&journal.transaction_id);
    let mut journal = journal;
    import_transaction::set_operation_status(&root, &mut journal, "fault", "rollback-pending")
        .unwrap();
    import_transaction::transition(
        &root,
        &mut journal,
        import_transaction::TransactionState::RollbackPending,
    )
    .unwrap();
    let error = import_transaction::recover(temp.path()).unwrap_err();
    assert_eq!(error.code, "recoverable_transaction");
    let saved: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("journal.json")).unwrap()).unwrap();
    assert_eq!(saved["state"], "rollback_pending");
}

#[test]
fn committed_recovery_verifies_final_digest_before_backup_cleanup() {
    let temp = tempfile::tempdir().unwrap();
    let output = temp.path().join("output.txt");
    let journal =
        import_transaction::create_journal(temp.path(), &output, vec!["replace".into()], None)
            .unwrap();
    let root = import_transaction::transaction_root(temp.path()).join(&journal.transaction_id);
    let backup = root.join("backup").join("output.txt");
    fs::create_dir_all(backup.parent().unwrap()).unwrap();
    fs::write(&backup, b"before").unwrap();
    fs::write(&output, b"after").unwrap();
    let mut journal = journal;
    import_transaction::add_backup(
        &root,
        &mut journal,
        &output,
        &backup,
        Some(blake3::hash(b"before").to_hex().to_string()),
        Some(blake3::hash(b"after").to_hex().to_string()),
    )
    .unwrap();
    import_transaction::transition(
        &root,
        &mut journal,
        import_transaction::TransactionState::Committed,
    )
    .unwrap();
    import_transaction::recover(temp.path()).unwrap();
    assert_eq!(fs::read(&output).unwrap(), b"after");
    assert!(!backup.exists());
}

#[test]
fn injected_asset_commit_failure_restores_old_directory_digest() {
    let temp = tempfile::tempdir().unwrap();
    let destination = temp.path().join("destination");
    fs::create_dir_all(&destination).unwrap();
    fs::write(destination.join("local.md"), b"before").unwrap();
    let before = import_transaction::path_digest(&destination).unwrap();
    let journal =
        import_transaction::create_journal(temp.path(), &destination, vec!["assets".into()], None)
            .unwrap();
    let root = import_transaction::transaction_root(temp.path()).join(&journal.transaction_id);
    let backup = root.join("backup").join("destination");
    fs::create_dir_all(backup.parent().unwrap()).unwrap();
    fs::rename(&destination, &backup).unwrap();
    fs::create_dir_all(&destination).unwrap();
    fs::write(destination.join("partial.md"), b"partial").unwrap();
    let mut journal = journal;
    import_transaction::add_backup(
        &root,
        &mut journal,
        &destination,
        &backup,
        Some(before.clone()),
        Some(import_transaction::path_digest(&destination).unwrap()),
    )
    .unwrap();
    import_transaction::set_operation_status(&root, &mut journal, "assets", "published").unwrap();
    import_transaction::transition(
        &root,
        &mut journal,
        import_transaction::TransactionState::AssetsCommitting,
    )
    .unwrap();
    import_transaction::recover(temp.path()).unwrap();
    assert_eq!(
        import_transaction::path_digest(&destination).unwrap(),
        before
    );
    assert!(!destination.join("partial.md").exists());
}

#[test]
fn rollback_failure_keeps_journal_blocking_and_preserves_evidence() {
    let temp = tempfile::tempdir().unwrap();
    let destination = temp.path().join("destination");
    fs::create_dir_all(&destination).unwrap();
    let original = destination.join("note.md");
    fs::write(&original, b"after").unwrap();
    let journal =
        import_transaction::create_journal(temp.path(), &destination, vec!["assets".into()], None)
            .unwrap();
    let root = import_transaction::transaction_root(temp.path()).join(&journal.transaction_id);
    let mut journal = journal;
    import_transaction::add_backup(
        &root,
        &mut journal,
        &original,
        &root.join("backup").join("note.md"),
        Some(blake3::hash(b"before").to_hex().to_string()),
        Some(blake3::hash(b"after").to_hex().to_string()),
    )
    .unwrap();
    import_transaction::transition(
        &root,
        &mut journal,
        import_transaction::TransactionState::AssetsCommitting,
    )
    .unwrap();
    let error = import_transaction::recover(temp.path()).unwrap_err();
    assert_eq!(error.code, "rollback_pending");
    assert!(root.join("journal.json").exists());
    let saved: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("journal.json")).unwrap()).unwrap();
    assert_eq!(saved["state"], "rollback_pending");
    assert_eq!(saved["operation_status"]["recovery"], "rollback-pending");
}

#[test]
fn simulated_cross_volume_sibling_backup_recovers_with_marker_validation() {
    let temp = tempfile::tempdir().unwrap();
    let destination = temp.path().join("destination");
    fs::create_dir_all(&destination).unwrap();
    let original = destination.join("note.md");
    fs::write(&original, b"before").unwrap();
    let journal =
        import_transaction::create_journal(temp.path(), &destination, vec!["assets".into()], None)
            .unwrap();
    let root = import_transaction::transaction_root(temp.path()).join(&journal.transaction_id);
    let sibling_root = destination
        .parent()
        .unwrap()
        .join(format!(".collectives-backup-{}", journal.transaction_id));
    fs::create_dir_all(&sibling_root).unwrap();
    fs::write(
        sibling_root.join(".collectives-owner"),
        format!("collectives-phase1-v1\n{}\n", journal.transaction_id),
    )
    .unwrap();
    let backup = sibling_root.join("payload");
    fs::rename(&original, &backup).unwrap();
    fs::write(&original, b"after").unwrap();
    let mut journal = journal;
    journal.cross_volume = true;
    journal.backup_stage_root = Some(sibling_root.to_string_lossy().into_owned());
    import_transaction::add_backup(
        &root,
        &mut journal,
        &original,
        &backup,
        Some(blake3::hash(b"before").to_hex().to_string()),
        Some(blake3::hash(b"after").to_hex().to_string()),
    )
    .unwrap();
    import_transaction::transition(
        &root,
        &mut journal,
        import_transaction::TransactionState::AssetsCommitting,
    )
    .unwrap();
    import_transaction::recover(temp.path()).unwrap();
    assert_eq!(fs::read(&original).unwrap(), b"before");
    assert!(!sibling_root.exists());
}
