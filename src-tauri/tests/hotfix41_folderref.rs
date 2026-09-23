use serde_json::Value;
use std::fs;
use tempfile::tempdir;

fn classification(error: &tauri_app_lib::safety_error::SafetyError) -> &str {
    error
        .details
        .get("classification")
        .and_then(Value::as_str)
        .unwrap_or("")
}

#[test]
fn create_then_read_folderref_child_returns_snapshot_once_ready() {
    let root = tempdir().unwrap();
    let child = root.path().join("new-note.MD");
    let first = tauri_app_lib::repositories::documents::read_folderref_snapshot(
        root.path().to_string_lossy().to_string(),
        child.to_string_lossy().to_string(),
    )
    .unwrap_err();
    assert_eq!(first.code, "stale_read");
    assert_eq!(classification(&first), "retryable");

    let staged = root.path().join("new-note.md.tmp");
    fs::write(&staged, "# synthetic hotfix note\n").unwrap();
    fs::rename(&staged, &child).unwrap();
    let snapshot = tauri_app_lib::repositories::documents::read_folderref_snapshot(
        root.path().to_string_lossy().to_string(),
        child.to_string_lossy().to_string(),
    )
    .unwrap();
    assert_eq!(snapshot.content, "# synthetic hotfix note\n");
    assert!(!snapshot.version_token.is_empty());
}

#[test]
fn folderref_rejects_outside_extension_and_directory_before_read() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let outside_child = outside.path().join("outside.md");
    fs::write(&outside_child, "outside").unwrap();
    let outside_error = tauri_app_lib::repositories::documents::read_folderref_snapshot(
        root.path().to_string_lossy().to_string(),
        outside_child.to_string_lossy().to_string(),
    )
    .unwrap_err();
    assert_eq!(outside_error.code, "stale_read");
    assert_eq!(classification(&outside_error), "terminal");

    let text_child = root.path().join("note.txt");
    fs::write(&text_child, "not markdown").unwrap();
    let text_snapshot = tauri_app_lib::repositories::documents::read_folderref_snapshot(
        root.path().to_string_lossy().to_string(),
        text_child.to_string_lossy().to_string(),
    )
    .unwrap();
    assert_eq!(text_snapshot.content, "not markdown");
    assert_eq!(text_snapshot.file_kind.as_deref(), Some("text-source"));

    let directory_child = root.path().join("directory.md");
    fs::create_dir(&directory_child).unwrap();
    let directory_error = tauri_app_lib::repositories::documents::read_folderref_snapshot(
        root.path().to_string_lossy().to_string(),
        directory_child.to_string_lossy().to_string(),
    )
    .unwrap_err();
    assert_eq!(classification(&directory_error), "terminal");
}

#[test]
fn folderref_rejects_invalid_utf8_as_terminal_error() {
    let root = tempdir().unwrap();
    let child = root.path().join("invalid.md");
    fs::write(&child, [0xff, 0xfe, 0xfd]).unwrap();
    let error = tauri_app_lib::repositories::documents::read_folderref_snapshot(
        root.path().to_string_lossy().to_string(),
        child.to_string_lossy().to_string(),
    )
    .unwrap_err();
    assert_eq!(error.code, "unsupported_file");
    assert_eq!(classification(&error), "terminal");
}

#[test]
fn ordinary_read_file_remains_generic_and_wire_compatible() {
    let root = tempdir().unwrap();
    let child = root.path().join("ordinary.txt");
    fs::write(&child, "ordinary content").unwrap();
    let snapshot =
        tauri_app_lib::repositories::documents::read_file(child.to_string_lossy().to_string())
            .unwrap();
    assert_eq!(snapshot.content, "ordinary content");
    assert!(!snapshot.version_token.is_empty());
}

#[cfg(unix)]
#[test]
fn folderref_rejects_symlink_escape() {
    use std::os::unix::fs::symlink;
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let outside_child = outside.path().join("outside.md");
    fs::write(&outside_child, "outside").unwrap();
    let link = root.path().join("link.md");
    symlink(&outside_child, &link).unwrap();
    let error = tauri_app_lib::repositories::documents::read_folderref_snapshot(
        root.path().to_string_lossy().to_string(),
        link.to_string_lossy().to_string(),
    )
    .unwrap_err();
    assert_eq!(classification(&error), "terminal");
}
