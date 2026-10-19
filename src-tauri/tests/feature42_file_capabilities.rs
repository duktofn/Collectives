use std::fs;
use tempfile::tempdir;

#[test]
fn writes_reject_unreadable_output_without_changing_the_original() {
    use tauri_app_lib::repositories::documents::{create_file, read_file, write_file};

    let root = tempdir().unwrap();
    let path = root.path().join("note.md").to_string_lossy().to_string();
    fs::write(&path, "original").unwrap();
    let token = read_file(path.clone()).unwrap().version_token;
    for (content, reason) in [
        ("x".repeat(10 * 1024 * 1024 + 1), "size"),
        ("invalid\0text".into(), "nul"),
    ] {
        let error = write_file(
            path.clone(),
            content,
            tauri_app_lib::repositories::documents::WritePrecondition::Version {
                token: token.clone(),
            },
        )
        .unwrap_err();
        assert_eq!(error.details["reason"], reason);
        assert_eq!(fs::read_to_string(&path).unwrap(), "original");
    }
    let new_path = root.path().join("new.md").to_string_lossy().to_string();
    assert_eq!(
        create_file(new_path.clone(), "invalid\0text".into())
            .unwrap_err()
            .details["reason"],
        "nul"
    );
    assert!(!std::path::Path::new(&new_path).exists());
    assert_eq!(root.path().read_dir().unwrap().count(), 1);
}

#[test]
fn arbitrary_text_names_open_and_folder_listings_identify_binary_files() {
    use tauri_app_lib::repositories::documents::{read_file, write_file};
    let root = tempdir().unwrap();
    for name in [
        "README",
        ".env",
        "Dockerfile",
        "example.unlisted",
        "text.bin",
    ] {
        let path = root.path().join(name);
        fs::write(&path, "Tiếng Việt\n").unwrap();
        let snapshot = read_file(path.to_string_lossy().into()).unwrap();
        assert_eq!(snapshot.file_kind.as_deref(), Some("text-source"));
        write_file(
            path.to_string_lossy().into(),
            "Updated\n".into(),
            tauri_app_lib::repositories::documents::WritePrecondition::Version {
                token: snapshot.version_token,
            },
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "Updated\n");
    }
    let binary = root.path().join("binary.custom");
    fs::write(&binary, [1, 2, 3]).unwrap();
    assert_eq!(
        read_file(binary.to_string_lossy().into())
            .unwrap_err()
            .details["reason"],
        "binary"
    );
    let boundary = root.path().join("unicode-boundary");
    fs::write(&boundary, format!("{}đ", "a".repeat(8191))).unwrap();
    let entries = tauri_app_lib::fs_ops::read_children(root.path()).unwrap();
    assert_eq!(
        entries
            .iter()
            .find(|entry| entry.name == "binary.custom")
            .unwrap()
            .is_text,
        Some(false)
    );
    assert!(entries
        .iter()
        .filter(|entry| entry.name != "binary.custom")
        .all(|entry| entry.is_text == Some(true)));
}

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
        tauri_app_lib::repositories::documents::WritePrecondition::Version {
            token: snapshot.version_token,
        },
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
        tauri_app_lib::repositories::documents::WritePrecondition::Version {
            token: mixed_snapshot.version_token,
        },
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
    let extensionless_snapshot = tauri_app_lib::repositories::documents::read_file(
        extensionless.to_string_lossy().to_string(),
    )
    .unwrap();
    assert_eq!(extensionless_snapshot.content, "text");
    assert_eq!(
        extensionless_snapshot.file_kind.as_deref(),
        Some("text-source")
    );

    let oversized = root.path().join("large.txt");
    let file = fs::File::create(&oversized).unwrap();
    file.set_len(10 * 1024 * 1024 + 1).unwrap();
    let size_error =
        tauri_app_lib::repositories::documents::read_file(oversized.to_string_lossy().to_string())
            .unwrap_err();
    assert_eq!(size_error.code, "unsupported_file");
    assert_eq!(size_error.details["reason"], "size");
}
