use std::fs;
use tempfile::tempdir;

#[test]
fn generated_policy_classifies_markdown_and_text_source_with_metadata() {
    let root = tempdir().unwrap();
    let markdown = root.path().join("note.MARKDOWN");
    fs::write(
        &markdown,
        [
            0xef, 0xbb, 0xbf, b'#', b' ', b'N', b'o', b't', b'e', b'\r', b'\n',
        ],
    )
    .unwrap();
    let snapshot =
        tauri_app_lib::repositories::documents::read_file(markdown.to_string_lossy().to_string())
            .unwrap();
    assert_eq!(snapshot.content, "# Note\r\n");
    assert_eq!(snapshot.file_kind.as_deref(), Some("markdown"));
    assert_eq!(snapshot.had_utf8_bom, Some(true));
    assert_eq!(snapshot.line_ending.as_deref(), Some("CRLF"));
    assert_eq!(snapshot.byte_size, Some(11));

    let json = root.path().join("settings.JSON");
    fs::write(&json, "{\"ok\":true}\n").unwrap();
    let json_snapshot =
        tauri_app_lib::repositories::documents::read_file(json.to_string_lossy().to_string())
            .unwrap();
    assert_eq!(json_snapshot.file_kind.as_deref(), Some("text-source"));

    let folderref_root = root.path().join("folderref");
    fs::create_dir(&folderref_root).unwrap();
    let folderref_markdown = folderref_root.join("child.markdown");
    fs::write(&folderref_markdown, b"# FolderRef\n").unwrap();
    let folderref_snapshot = tauri_app_lib::repositories::documents::read_folderref_snapshot(
        folderref_root.to_string_lossy().to_string(),
        "child.markdown".into(),
    )
    .unwrap();
    assert_eq!(folderref_snapshot.content, "# FolderRef\n");
    assert_eq!(folderref_snapshot.file_kind.as_deref(), Some("markdown"));
}

#[test]
fn save_preserves_bom_and_crlf_and_unchanged_mixed_content_is_not_rewritten() {
    let root = tempdir().unwrap();
    let crlf = root.path().join("crlf.txt");
    let original = [0xef, 0xbb, 0xbf, b'a', b'\r', b'\n', b'b', b'\r', b'\n'];
    fs::write(&crlf, original).unwrap();
    let snapshot =
        tauri_app_lib::repositories::documents::read_file(crlf.to_string_lossy().to_string())
            .unwrap();
    tauri_app_lib::repositories::documents::write_file(
        crlf.to_string_lossy().to_string(),
        "a\nc\n".into(),
        Some(snapshot.version_token),
    )
    .unwrap();
    let saved = fs::read(&crlf).unwrap();
    assert!(saved.starts_with(&[0xef, 0xbb, 0xbf]));
    assert_eq!(&saved[3..], b"a\r\nc\r\n");

    let mixed = root.path().join("mixed.txt");
    let mixed_bytes = b"a\r\nb\nc\n";
    fs::write(&mixed, mixed_bytes).unwrap();
    let mixed_snapshot =
        tauri_app_lib::repositories::documents::read_file(mixed.to_string_lossy().to_string())
            .unwrap();
    tauri_app_lib::repositories::documents::write_file(
        mixed.to_string_lossy().to_string(),
        mixed_snapshot.content.clone(),
        Some(mixed_snapshot.version_token),
    )
    .unwrap();
    assert_eq!(fs::read(&mixed).unwrap(), mixed_bytes);
}

#[test]
fn unsupported_nul_and_size_are_structured_without_external_paths() {
    let root = tempdir().unwrap();
    let nul = root.path().join("nul.json");
    fs::write(&nul, [b'{', 0, b'}']).unwrap();
    let nul_error =
        tauri_app_lib::repositories::documents::read_file(nul.to_string_lossy().to_string())
            .unwrap_err();
    assert_eq!(nul_error.code, "unsupported_file");
    assert_eq!(nul_error.details["reason"], "nul");

    let extensionless = root.path().join("README");
    fs::write(&extensionless, "text").unwrap();
    let extension_error = tauri_app_lib::repositories::documents::read_file(
        extensionless.to_string_lossy().to_string(),
    )
    .unwrap_err();
    assert_eq!(extension_error.code, "unsupported_file");
    assert_eq!(extension_error.details["reason"], "extension");

    let oversized = root.path().join("large.txt");
    let file = fs::File::create(&oversized).unwrap();
    file.set_len(10 * 1024 * 1024 + 1).unwrap();
    let size_error =
        tauri_app_lib::repositories::documents::read_file(oversized.to_string_lossy().to_string())
            .unwrap_err();
    assert_eq!(size_error.code, "unsupported_file");
    assert_eq!(size_error.details["reason"], "size");
}
