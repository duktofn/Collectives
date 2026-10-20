use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri_app_lib::collection::{archive, import_transaction, Collection, Entry};
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

fn collection_with_asset_path(asset_path: &str) -> Collection {
    Collection {
        id: "archive-fault-matrix".into(),
        schema_version: 1,
        name: "Fault Matrix".into(),
        created_at: "2026-10-19T00:00:00Z".into(),
        updated_at: "2026-10-19T00:00:00Z".into(),
        entries: vec![Entry::File {
            id: "note".into(),
            path: asset_path.into(),
        }],
        metadata: None,
    }
}

fn write_archive(
    path: &Path,
    collection: &Collection,
    members: Vec<(String, Vec<u8>, Option<u32>)>,
) {
    let file = File::create(path).unwrap();
    let mut zip = ZipWriter::new(file);
    let manifest_options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .unix_permissions(0o644);
    zip.start_file("manifest.json", manifest_options).unwrap();
    zip.write_all(&serde_json::to_vec(collection).unwrap())
        .unwrap();

    for (name, bytes, unix_mode) in members {
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored)
            .unix_permissions(unix_mode.unwrap_or(0o644));
        zip.start_file(name, options).unwrap();
        zip.write_all(&bytes).unwrap();
    }
    zip.finish().unwrap();
}

fn temp_root_on_drive(drive: char) -> tempfile::TempDir {
    let prefix = format!("{}:\\", drive.to_ascii_uppercase());
    let candidates = [
        std::env::temp_dir(),
        PathBuf::from(format!("{}:\\Windows\\Temp", drive)),
        PathBuf::from(format!("{}:\\Users\\Public", drive)),
        PathBuf::from(format!("{}:\\a\\_temp", drive)),
        PathBuf::from(format!("{}:\\Projects", drive)),
    ];
    for candidate in candidates {
        let candidate_text = candidate.to_string_lossy().to_ascii_uppercase();
        if !candidate.exists() || !candidate_text.starts_with(&prefix) {
            continue;
        }
        if let Ok(temp) = tempfile::Builder::new()
            .prefix("collectives-archive-fault-")
            .tempdir_in(candidate)
        {
            return temp;
        }
    }
    panic!("no writable temporary directory found on drive {drive}:");
}

fn cross_volume_journal_count(collections_dir: &Path) -> usize {
    let root = import_transaction::transaction_root(collections_dir);
    fs::read_dir(root)
        .unwrap()
        .filter_map(Result::ok)
        .filter_map(|entry| fs::read(entry.path().join("journal.json")).ok())
        .filter_map(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .filter(|journal| journal["cross_volume"] == true)
        .count()
}

#[test]
fn traversal_member_is_rejected_before_creating_or_changing_a_destination() {
    let temp = tempfile::tempdir().unwrap();
    let collections = temp.path().join("collections");
    fs::create_dir_all(&collections).unwrap();
    let zip_path = temp.path().join("traversal.zip");
    let destination = temp.path().join("destination");
    let outside = temp.path().join("escape.md");
    let collection = collection_with_asset_path("assets/note.md");
    write_archive(
        &zip_path,
        &collection,
        vec![("assets/../escape.md".into(), b"escape".to_vec(), None)],
    );

    let error =
        archive::import_zip(&collections, &zip_path, &destination, HashMap::new()).unwrap_err();

    assert!(error.contains("invalid_archive_member"), "{error}");
    assert!(!destination.exists());
    assert!(!outside.exists());
    assert!(!import_transaction::transaction_root(&collections).exists());
}

#[test]
fn symlink_zip_member_is_rejected_before_import() {
    let temp = tempfile::tempdir().unwrap();
    let collections = temp.path().join("collections");
    fs::create_dir_all(&collections).unwrap();
    let zip_path = temp.path().join("symlink.zip");
    let destination = temp.path().join("destination");
    let collection = collection_with_asset_path("assets/note.md");
    let file = File::create(&zip_path).unwrap();
    let mut zip = ZipWriter::new(file);
    let manifest_options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .unix_permissions(0o644);
    zip.start_file("manifest.json", manifest_options).unwrap();
    zip.write_all(&serde_json::to_vec(&collection).unwrap())
        .unwrap();
    zip.add_symlink("assets/note.md", "target.md", SimpleFileOptions::default())
        .unwrap();
    zip.finish().unwrap();

    let error =
        archive::import_zip(&collections, &zip_path, &destination, HashMap::new()).unwrap_err();

    assert!(error.contains("special or symlink"), "{error}");
    assert!(!destination.exists());
    assert!(!import_transaction::transaction_root(&collections).exists());
}

#[cfg(windows)]
#[test]
fn destination_reparse_component_is_rejected_without_writing_outside_it() {
    use std::process::Command;

    let temp = tempfile::tempdir().unwrap();
    let collections = temp.path().join("collections");
    fs::create_dir_all(&collections).unwrap();
    let zip_path = temp.path().join("safe.zip");
    let outside = temp.path().join("outside");
    let reparse = temp.path().join("reparse");
    fs::create_dir_all(&outside).unwrap();
    let junction = Command::new("cmd.exe")
        .arg("/C")
        .arg("mklink")
        .arg("/J")
        .arg(&reparse)
        .arg(&outside)
        .output()
        .unwrap();
    assert!(
        junction.status.success(),
        "could not create a temporary junction: {}",
        String::from_utf8_lossy(&junction.stderr)
    );
    let destination = reparse.join("selected");
    let collection = collection_with_asset_path("assets/note.md");
    write_archive(
        &zip_path,
        &collection,
        vec![(
            "assets/note.md".into(),
            b"must stay contained".to_vec(),
            None,
        )],
    );

    let error =
        archive::import_zip(&collections, &zip_path, &destination, HashMap::new()).unwrap_err();

    assert!(
        error.contains("reparse") || error.contains("symlink"),
        "{error}"
    );
    assert!(!outside.join("selected").exists());
    assert!(!import_transaction::transaction_root(&collections).exists());
}

#[cfg(windows)]
#[test]
fn case_colliding_zip_members_require_an_explicit_non_overwrite_resolution() {
    let temp = tempfile::tempdir().unwrap();
    let collections = temp.path().join("collections");
    fs::create_dir_all(&collections).unwrap();
    let zip_path = temp.path().join("duplicate.zip");
    let destination = temp.path().join("destination");
    let collection = collection_with_asset_path("assets/note.md");
    write_archive(
        &zip_path,
        &collection,
        vec![
            ("assets/note.md".into(), b"first".to_vec(), None),
            ("assets/NOTE.md".into(), b"second".to_vec(), None),
        ],
    );

    let conflicts = archive::check_zip_conflicts(&zip_path, &destination).unwrap();
    assert_eq!(conflicts.len(), 1);
    assert_eq!(conflicts[0].kind, "internal-collision");
    assert_eq!(conflicts[0].allowed_resolutions, vec!["rename", "skip"]);

    let error =
        archive::import_zip(&collections, &zip_path, &destination, HashMap::new()).unwrap_err();
    assert!(error.contains("unresolved_conflict"), "{error}");
    assert!(!destination.exists());
    assert!(!collections.join("archive-fault-matrix.json").exists());
}

#[cfg(windows)]
#[test]
fn import_and_both_export_paths_publish_complete_cross_volume_outputs() {
    let collections_root = temp_root_on_drive('C');
    let destination_root = temp_root_on_drive('D');
    let collections = collections_root.path().join("collections");
    fs::create_dir_all(&collections).unwrap();
    let zip_path = collections_root.path().join("input.zip");
    let destination = destination_root.path().join("imported");
    fs::create_dir_all(&destination).unwrap();
    fs::write(destination.join("note.md"), b"previous destination").unwrap();
    fs::write(destination.join("keep.md"), b"preserve unrelated file").unwrap();
    let collection = collection_with_asset_path("assets/note.md");
    write_archive(
        &zip_path,
        &collection,
        vec![(
            "assets/note.md".into(),
            b"cross-volume contents".to_vec(),
            None,
        )],
    );

    let conflicts = archive::check_zip_conflicts(&zip_path, &destination).unwrap();
    assert_eq!(conflicts.len(), 1);
    let imported = archive::import_zip(
        &collections,
        &zip_path,
        &destination,
        HashMap::from([(conflicts[0].conflict_id.clone(), "overwrite".into())]),
    )
    .unwrap();
    assert_eq!(
        fs::read(destination.join("note.md")).unwrap(),
        b"cross-volume contents"
    );
    assert_eq!(
        fs::read(destination.join("keep.md")).unwrap(),
        b"preserve unrelated file"
    );
    assert_eq!(cross_volume_journal_count(&collections), 1);

    let exported_zip = destination_root.path().join("exported.zip");
    archive::export_to_zip(&collections, &imported.id, &exported_zip).unwrap();
    let mut exported = ZipArchive::new(File::open(&exported_zip).unwrap()).unwrap();
    let mut exported_note = Vec::new();
    exported
        .by_name("assets/note.md")
        .unwrap()
        .read_to_end(&mut exported_note)
        .unwrap();
    assert_eq!(exported_note, b"cross-volume contents");
    assert_eq!(cross_volume_journal_count(&collections), 2);

    let exported_folder = destination_root.path().join("exported-folder");
    let source_note = destination.join("note.md");
    let mut source_permissions = fs::metadata(&source_note).unwrap().permissions();
    source_permissions.set_readonly(true);
    fs::set_permissions(&source_note, source_permissions).unwrap();
    let export_result = archive::export_to_folder(&collections, &imported.id, &exported_folder);
    let clear_readonly = std::process::Command::new("attrib.exe")
        .arg("-R")
        .arg(&source_note)
        .output()
        .unwrap();
    assert!(
        clear_readonly.status.success(),
        "could not clear the temporary read-only flag: {}",
        String::from_utf8_lossy(&clear_readonly.stderr)
    );
    export_result.unwrap();
    assert_eq!(
        fs::read(exported_folder.join("note.md")).unwrap(),
        b"cross-volume contents"
    );
    assert_eq!(cross_volume_journal_count(&collections), 3);
}
