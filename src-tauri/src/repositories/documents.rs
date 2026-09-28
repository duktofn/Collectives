use crate::safety_error::SafetyError;

const MAX_DOCUMENT_BYTES: u64 = 10 * 1024 * 1024;

fn unsupported_error(reason: &str, message: &str) -> SafetyError {
    SafetyError::new("unsupported_file", message).with_details(serde_json::json!({
        "classification": "terminal",
        "reason": reason
    }))
}

fn line_ending(bytes: &[u8]) -> &'static str {
    let mut has_lf = false;
    let mut has_crlf = false;
    let mut has_lone_cr = false;
    for index in 0..bytes.len() {
        if bytes[index] == b'\n' {
            if index > 0 && bytes[index - 1] == b'\r' {
                has_crlf = true;
            } else {
                has_lf = true;
            }
        } else if bytes[index] == b'\r' && bytes.get(index + 1) != Some(&b'\n') {
            has_lone_cr = true;
        }
    }
    if !has_lf && !has_crlf && !has_lone_cr {
        "none"
    } else if (has_lf && has_crlf) || has_lone_cr {
        "mixed"
    } else if has_crlf {
        "CRLF"
    } else {
        "LF"
    }
}

fn file_kind(
    path: &std::path::Path,
) -> Result<crate::file_capabilities_generated::FileKind, SafetyError> {
    crate::file_capabilities_generated::classify_path(path)
        .ok_or_else(|| unsupported_error("extension", "File extension is not supported"))
}

fn decode_document(path: &std::path::Path) -> Result<FileSnapshot, SafetyError> {
    let kind = file_kind(path)?;
    let metadata = std::fs::metadata(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            SafetyError::new("stale_read", format!("Failed to read file: {error}")).with_details(
                serde_json::json!({
                    "classification": "retryable",
                    "reason": "absent_or_create_rename"
                }),
            )
        } else {
            unsupported_error(
                "unreadable",
                &format!("File metadata could not be read: {error}"),
            )
        }
    })?;
    if !metadata.is_file() {
        return Err(unsupported_error(
            "not_regular_file",
            "Only regular files can be opened",
        ));
    }
    let bytes = std::fs::read(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            SafetyError::new("stale_read", format!("Failed to read file: {error}")).with_details(
                serde_json::json!({
                    "classification": "retryable",
                    "reason": "absent_or_create_rename"
                }),
            )
        } else {
            unsupported_error("unreadable", &format!("File could not be read: {error}"))
        }
    })?;
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(unsupported_error(
            "size",
            "File exceeds the 10 MiB text-source limit",
        ));
    }
    if bytes.contains(&0) {
        return Err(unsupported_error("nul", "File contains NUL bytes"));
    }
    let had_bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let content_bytes = if had_bom { &bytes[3..] } else { &bytes[..] };
    let content = String::from_utf8(content_bytes.to_vec())
        .map_err(|_| unsupported_error("encoding", "File is not valid UTF-8"))?;
    let token = blake3::hash(&bytes).to_hex().to_string();
    Ok(FileSnapshot {
        content,
        version_token: token,
        file_kind: Some(match kind {
            crate::file_capabilities_generated::FileKind::Markdown => "markdown".into(),
            crate::file_capabilities_generated::FileKind::TextSource => "text-source".into(),
        }),
        had_utf8_bom: Some(had_bom),
        line_ending: Some(line_ending(content_bytes).into()),
        byte_size: Some(bytes.len() as u64),
    })
}

pub fn read_file(path: String) -> Result<FileSnapshot, SafetyError> {
    decode_document(std::path::Path::new(&path))
}

fn folderref_read_error(classification: &str, reason: &str, message: &str) -> SafetyError {
    SafetyError::new("stale_read", message).with_details(serde_json::json!({
        "classification": classification,
        "reason": reason,
    }))
}

fn has_reparse_or_symlink(path: &std::path::Path) -> Result<bool, std::io::Error> {
    let metadata = std::fs::symlink_metadata(path)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Ok(true);
        }
    }
    Ok(metadata.file_type().is_symlink())
}

fn validate_no_reparse_components(path: &std::path::Path) -> Result<(), SafetyError> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        match has_reparse_or_symlink(candidate) {
            Ok(true) => {
                return Err(folderref_read_error(
                    "terminal",
                    "reparse_escape",
                    "FolderRef path contains a symlink or reparse point",
                ))
            }
            Ok(false) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(folderref_read_error(
                    "terminal",
                    "path_metadata",
                    &format!("FolderRef path metadata failed: {error}"),
                ))
            }
        }
        current = candidate.parent();
    }
    Ok(())
}

fn normalized_path(path: &std::path::Path) -> String {
    path.to_string_lossy().replace('\\', "/").to_lowercase()
}

fn contained_path(root: &std::path::Path, candidate: &std::path::Path) -> bool {
    let root = normalized_path(root);
    let candidate = normalized_path(candidate);
    candidate == root || candidate.starts_with(&(root + "/"))
}

fn nearest_existing_ancestor(path: &std::path::Path) -> Result<std::path::PathBuf, SafetyError> {
    let mut current = path.to_path_buf();
    loop {
        match std::fs::symlink_metadata(&current) {
            Ok(_) => return Ok(current),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if !current.pop() {
                    return Err(folderref_read_error(
                        "terminal",
                        "ancestor_missing",
                        "FolderRef child has no existing ancestor",
                    ));
                }
            }
            Err(error) => {
                return Err(folderref_read_error(
                    "terminal",
                    "ancestor_metadata",
                    &format!("FolderRef child metadata failed: {error}"),
                ))
            }
        }
    }
}

pub fn read_folderref_snapshot(
    root_path: String,
    child_path: String,
) -> Result<FileSnapshot, SafetyError> {
    let requested_root = std::path::PathBuf::from(root_path);
    let requested_child = std::path::PathBuf::from(child_path);
    validate_no_reparse_components(&requested_root)?;
    let root = std::fs::canonicalize(&requested_root).map_err(|_| {
        folderref_read_error("terminal", "root_missing", "FolderRef root is unavailable")
    })?;
    if !root.is_dir() {
        return Err(folderref_read_error(
            "terminal",
            "root_not_directory",
            "FolderRef root is not a directory",
        ));
    }

    let candidate = if requested_child.is_absolute() {
        requested_child
    } else {
        root.join(requested_child)
    };
    validate_no_reparse_components(&candidate)?;
    let ancestor = nearest_existing_ancestor(&candidate)?;
    let canonical_ancestor = std::fs::canonicalize(&ancestor).map_err(|_| {
        folderref_read_error(
            "terminal",
            "ancestor_missing",
            "FolderRef child is not ready",
        )
    })?;
    if !contained_path(&root, &canonical_ancestor) {
        return Err(folderref_read_error(
            "terminal",
            "containment",
            "FolderRef child is outside its root",
        ));
    }
    if !candidate.exists() {
        return Err(folderref_read_error(
            "retryable",
            "absent_or_create_rename",
            "FolderRef child is not ready yet",
        ));
    }
    let canonical_child = std::fs::canonicalize(&candidate).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            folderref_read_error(
                "retryable",
                "absent_or_create_rename",
                "FolderRef child is not ready yet",
            )
        } else {
            folderref_read_error(
                "terminal",
                "canonicalize",
                "FolderRef child could not be canonicalized",
            )
        }
    })?;
    if !contained_path(&root, &canonical_child) {
        return Err(folderref_read_error(
            "terminal",
            "containment",
            "FolderRef child is outside its root",
        ));
    }
    let metadata = std::fs::metadata(&canonical_child).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            folderref_read_error(
                "retryable",
                "absent_or_create_rename",
                "FolderRef child is not ready yet",
            )
        } else {
            folderref_read_error(
                "terminal",
                "metadata",
                "FolderRef child metadata could not be read",
            )
        }
    })?;
    if !metadata.is_file() {
        return Err(folderref_read_error(
            "terminal",
            "not_regular_file",
            "FolderRef child is not a regular file",
        ));
    }
    decode_document(&canonical_child)
}

pub fn write_file(
    path: String,
    content: String,
    expected_token: Option<String>,
) -> Result<DocumentWriteReceipt, SafetyError> {
    let path = std::path::Path::new(&path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            SafetyError::new("save_failed", format!("Failed to create directories: {e}"))
        })?;
    }
    let original_bytes =
        if path.exists() {
            Some(std::fs::read(path).map_err(|e| {
                SafetyError::new("stale_read", format!("Failed to re-read file: {e}"))
            })?)
        } else {
            None
        };
    let original = if original_bytes.is_some() {
        Some(decode_document(path)?)
    } else {
        None
    };
    if let Some(expected) = expected_token.as_ref() {
        let actual = file_version_token(path, "").map_err(SafetyError::from)?;
        if &actual != expected {
            return Err(SafetyError::new(
                "external_change_conflict",
                "File changed outside the editor; draft was retained",
            ));
        }
    }
    if original.as_ref().map(|snapshot| snapshot.content.as_str()) == Some(content.as_str()) {
        let version_token = blake3::hash(original_bytes.as_deref().unwrap_or_default())
            .to_hex()
            .to_string();
        return Ok(DocumentWriteReceipt { version_token });
    }
    let bytes_to_write = encode_document(&content, original.as_ref(), original_bytes.as_deref());
    let version_token = blake3::hash(&bytes_to_write).to_hex().to_string();
    let id = uuid::Uuid::new_v4().to_string();
    let tmp_filename = format!(
        "{}.tmp-{}",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("file"),
        id
    );
    let tmp_path = path.with_file_name(tmp_filename);
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&tmp_path)
        .map_err(|e| SafetyError::new("save_failed", format!("Failed to write temp file: {e}")))?;
    use std::io::Write;
    file.write_all(&bytes_to_write)
        .map_err(|e| SafetyError::new("save_failed", format!("Failed to write temp file: {e}")))?;
    file.sync_all()
        .map_err(|e| SafetyError::new("save_failed", format!("Failed to flush temp file: {e}")))?;
    drop(file);
    if let Some(expected) = expected_token.as_ref() {
        let actual = file_version_token(path, "").map_err(SafetyError::from)?;
        if &actual != expected {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(SafetyError::new(
                "external_change_conflict",
                "File changed outside the editor immediately before replacement; draft was retained",
            ));
        }
    }
    replace_file_preserving(&tmp_path, path)?;
    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        std::fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| {
                SafetyError::new(
                    "recoverable_transaction",
                    format!("directory fsync after file replacement failed: {error}"),
                )
            })?;
    }
    Ok(DocumentWriteReceipt { version_token })
}

#[cfg(windows)]
fn replace_file_preserving_windows(
    replacement: &std::path::Path,
    destination: &std::path::Path,
    backup: &std::path::Path,
) -> Result<(), std::io::Error> {
    use std::os::windows::ffi::OsStrExt;
    extern "system" {
        fn ReplaceFileW(
            replaced_file_name: *const u16,
            replacement_file_name: *const u16,
            backup_file_name: *const u16,
            replace_flags: u32,
            exclude: *mut std::ffi::c_void,
            reserved: *mut std::ffi::c_void,
        ) -> i32;
    }
    let replaced: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let replacement: Vec<u16> = replacement
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let backup: Vec<u16> = backup.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        ReplaceFileW(
            replaced.as_ptr(),
            replacement.as_ptr(),
            backup.as_ptr(),
            0x0000_0001,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn replace_file_preserving(
    replacement: &std::path::Path,
    destination: &std::path::Path,
) -> Result<(), SafetyError> {
    #[cfg(windows)]
    {
        if destination.exists() {
            let backup = destination.with_file_name(format!(
                ".{}.collectives-backup-{}",
                destination
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("file"),
                uuid::Uuid::new_v4()
            ));
            replace_file_preserving_windows(replacement, destination, &backup).map_err(
                |error| {
                    SafetyError::new(
                        "recoverable_transaction",
                        format!("Windows ReplaceFileW preservation failed: {error}"),
                    )
                },
            )?;
            if let Err(error) = std::fs::remove_file(&backup) {
                return Err(SafetyError::new(
                    "recoverable_transaction",
                    format!(
                        "Windows replacement succeeded but owned backup cleanup failed: {error}"
                    ),
                ));
            }
            return Ok(());
        }
    }
    std::fs::rename(replacement, destination).map_err(|error| {
        SafetyError::new(
            "recoverable_transaction",
            format!("Failed to replace file without deleting the old output: {error}"),
        )
    })
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSnapshot {
    pub content: String,
    pub version_token: String,
    pub file_kind: Option<String>,
    pub had_utf8_bom: Option<bool>,
    pub line_ending: Option<String>,
    pub byte_size: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentWriteReceipt {
    pub version_token: String,
}

pub type FileSnapshot = DocumentSnapshot;

fn file_version_token(path: &std::path::Path, content: &str) -> Result<String, String> {
    let _ = content;
    Ok(
        blake3::hash(&std::fs::read(path).map_err(|e| e.to_string())?)
            .to_hex()
            .to_string(),
    )
}

fn encode_document(
    content: &str,
    original: Option<&FileSnapshot>,
    original_bytes: Option<&[u8]>,
) -> Vec<u8> {
    let mut normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    if let Some(snapshot) = original {
        let newline = match snapshot.line_ending.as_deref() {
            Some("CRLF") => "\r\n",
            Some("mixed") => {
                let bytes = original_bytes.unwrap_or_default();
                let crlf = bytes.windows(2).filter(|pair| pair == b"\r\n").count();
                let lone_lf = bytes
                    .iter()
                    .enumerate()
                    .filter(|(index, byte)| {
                        **byte == b'\n' && (*index == 0 || bytes[*index - 1] != b'\r')
                    })
                    .count();
                if crlf > lone_lf {
                    "\r\n"
                } else {
                    "\n"
                }
            }
            _ => "\n",
        };
        if newline == "\r\n" {
            normalized = normalized.replace('\n', "\r\n");
        }
    }
    let mut output = normalized.into_bytes();
    if original
        .and_then(|snapshot| snapshot.had_utf8_bom)
        .unwrap_or(false)
    {
        let mut with_bom = vec![0xef, 0xbb, 0xbf];
        with_bom.extend(output);
        output = with_bom;
    }
    output
}

#[cfg(all(test, windows))]
mod windows_replacement_tests {
    use super::replace_file_preserving;
    use std::fs;

    #[test]
    fn replace_preserves_old_content_until_windows_replace_succeeds() {
        let temp = tempfile::tempdir().unwrap();
        let destination = temp.path().join("note.md");
        let replacement = temp.path().join("note.md.tmp");
        fs::write(&destination, b"old").unwrap();
        fs::write(&replacement, b"new").unwrap();
        replace_file_preserving(&replacement, &destination).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"new");
        assert!(!replacement.exists());
    }
}
