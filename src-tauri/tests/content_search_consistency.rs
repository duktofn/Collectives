use std::fs::{self, File, FileTimes, OpenOptions};
use std::path::Path;
use tauri_app_lib::link_index::IndexEntry;
use tauri_app_lib::repositories::content_search::search_note_content;

fn file_entry(collection_id: &str, entry_id: &str, path: &Path) -> IndexEntry {
    IndexEntry {
        display_name: path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("note")
            .to_string(),
        collection_id: collection_id.to_string(),
        entry_id: entry_id.to_string(),
        path: path.to_string_lossy().into_owned(),
        entry_type: "file".into(),
    }
}

fn folder_ref(collection_id: &str, entry_id: &str, path: &Path) -> IndexEntry {
    IndexEntry {
        display_name: entry_id.to_string(),
        collection_id: collection_id.to_string(),
        entry_id: entry_id.to_string(),
        path: path.to_string_lossy().into_owned(),
        entry_type: "folder-ref".into(),
    }
}

fn search(
    indexed: Vec<IndexEntry>,
    query: &str,
    offset: usize,
    limit: usize,
) -> tauri_app_lib::application::domain::ContentSearchPage {
    search_note_content(indexed, query, offset, limit).unwrap()
}

#[test]
fn same_size_edit_with_restored_modified_time_invalidates_cached_match() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("same-size.md");
    fs::write(&path, b"start target end").unwrap();
    let original_metadata = fs::metadata(&path).unwrap();
    let original_size = original_metadata.len();
    let original_modified = original_metadata.modified().unwrap();
    let indexed = || vec![folder_ref("same-size-collection", "folder", temp.path())];

    let first = search(indexed(), "target", 0, 20);
    assert_eq!(first.total, 1);
    assert_eq!(first.results[0].path, path.to_string_lossy().into_owned());
    assert_eq!(search(indexed(), "target", 0, 20), first);

    fs::write(&path, b"start hidden end").unwrap();
    OpenOptions::new()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(FileTimes::new().set_modified(original_modified))
        .unwrap();
    let edited_metadata = fs::metadata(&path).unwrap();
    assert_eq!(edited_metadata.len(), original_size);
    assert_eq!(edited_metadata.modified().unwrap(), original_modified);

    let edited = search(indexed(), "target", 0, 20);
    assert_eq!(edited.total, 0);
    assert_eq!(edited.scanned_files, 1);
}

#[test]
fn folder_reference_search_reenumerates_unwatched_nested_files() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("external-folder");
    let nested = root.join("collapsed-child");
    fs::create_dir_all(&nested).unwrap();
    let first_path = nested.join("first.md");
    fs::write(&first_path, "needle one").unwrap();
    let indexed = || vec![folder_ref("folder-collection", "folder-ref", &root)];

    let first = search(indexed(), "needle", 0, 20);
    assert_eq!(first.total, 1);

    let second_path = root.join("second.md");
    let second_path_string = second_path.to_string_lossy().into_owned();
    fs::write(&second_path, "needle two").unwrap();
    let second = search(indexed(), "needle", 0, 20);
    assert_eq!(second.total, 2);
    assert!(second
        .results
        .iter()
        .any(|result| result.path == second_path_string));

    fs::remove_file(&first_path).unwrap();
    let third = search(indexed(), "needle", 0, 20);
    assert_eq!(third.total, 1);
    assert_eq!(third.results[0].path, second_path_string);
}

#[test]
fn unreadable_and_missing_files_never_reuse_stale_matches() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("mutable.md");
    fs::write(&path, "needle here").unwrap();
    let indexed = || vec![file_entry("read-error-collection", "mutable", &path)];
    assert_eq!(search(indexed(), "needle", 0, 20).total, 1);

    fs::write(&path, [0xff, b'n', b'e', b'e', b'd', b'l', b'e']).unwrap();
    let unreadable = search(indexed(), "needle", 0, 20);
    assert_eq!(unreadable.total, 0);
    assert_eq!(unreadable.skipped_files, 1);

    fs::remove_file(&path).unwrap();
    let missing = search(indexed(), "needle", 0, 20);
    assert_eq!(missing.total, 0);
    assert_eq!(missing.skipped_files, 1);

    fs::write(&path, "other text").unwrap();
    let restored = search(indexed(), "needle", 0, 20);
    assert_eq!(restored.total, 0);
    assert_eq!(restored.skipped_files, 0);
    assert_eq!(restored.scanned_files, 1);
}

#[test]
fn collection_identity_is_part_of_the_match_cache_key() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("shared.md");
    fs::write(&path, "needle in shared file").unwrap();

    let first = search(
        vec![file_entry("collection-a", "entry-a", &path)],
        "needle",
        0,
        20,
    );
    let second = search(
        vec![file_entry("collection-b", "entry-b", &path)],
        "needle",
        0,
        20,
    );
    assert_eq!(first.results[0].entry_id, "entry-a");
    assert_eq!(second.results[0].entry_id, "entry-b");
    assert_eq!(first.results[0].path, second.results[0].path);
}

#[test]
fn query_utf16_limit_and_file_size_read_cap_are_unchanged() {
    let too_long = "😀".repeat(257);
    let error = search_note_content(Vec::new(), &too_long, 0, 20).unwrap_err();
    assert!(error.contains("maximum 512"));

    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("oversized.md");
    File::create(&path)
        .unwrap()
        .set_len(10 * 1024 * 1024 + 1)
        .unwrap();
    let page = search(
        vec![file_entry("oversized-collection", "oversized", &path)],
        "needle",
        0,
        20,
    );
    assert_eq!(page.total, 0);
    assert_eq!(page.scanned_files, 0);
    assert_eq!(page.skipped_files, 1);
    assert!(!page.truncated);
}

#[test]
fn total_byte_cap_still_truncates_before_reading_the_next_file() {
    let temp = tempfile::tempdir().unwrap();
    let content_size = 10 * 1024 * 1024;
    let mut content = Vec::with_capacity(content_size);
    while content.len() + 4096 <= content_size {
        content.extend(std::iter::repeat_n(b'a', 4095));
        content.push(b'\n');
    }
    content.resize(content_size, b'a');

    let mut indexed = Vec::new();
    for index in 0..7 {
        let path = temp.path().join(format!("large-{index}.md"));
        fs::write(&path, &content).unwrap();
        indexed.push(file_entry(
            "total-cap-collection",
            &format!("large-{index}"),
            &path,
        ));
    }

    let page = search(indexed, "absent-query", 0, 20);
    assert_eq!(page.total, 0);
    assert_eq!(page.scanned_files, 6);
    assert_eq!(page.skipped_files, 0);
    assert!(page.truncated);
}
