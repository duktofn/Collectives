use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub is_text: Option<bool>,
}

pub fn normalize_path(path: &str) -> String {
    path.replace('\\', "/")
}

pub fn read_children(path: &Path) -> Result<Vec<FsEntry>, String> {
    if !path.exists() {
        return Err(format!("Path does not exist: {:?}", path));
    }
    if !path.is_dir() {
        return Err(format!("Path is not a directory: {:?}", path));
    }

    let entries = fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut fs_entries = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path_buf = entry.path();
        let name = path_buf
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        if name.is_empty() {
            continue;
        }

        let is_dir = path_buf.is_dir();
        if !is_dir && crate::fs_layer::owned_artifacts::is_owned_document_artifact(&path_buf) {
            continue;
        }
        let size = if is_dir {
            None
        } else {
            entry.metadata().ok().map(|m| m.len())
        };

        fs_entries.push(FsEntry {
            name,
            path: normalize_path(&path_buf.to_string_lossy()),
            is_dir,
            size,
            is_text: if is_dir {
                None
            } else {
                crate::text_files::probe_text_file(&path_buf)
            },
        });
    }

    // Sort: directories first, then files, both alphabetically case-insensitive
    fs_entries.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir) // true (is_dir) comes first
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(fs_entries)
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_type().is_symlink() || (metadata.file_attributes() & 0x0400) != 0
}

#[cfg(not(windows))]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

fn canonical_path_without_reparse(path: &Path) -> Result<PathBuf, String> {
    let mut ancestors = path.ancestors().collect::<Vec<_>>();
    ancestors.reverse();
    for ancestor in ancestors {
        let metadata = fs::symlink_metadata(ancestor).map_err(|error| {
            format!("folderref_candidate_scan_incomplete: path metadata failed: {error}")
        })?;
        if is_reparse_point(&metadata) {
            return Err(
                "folderref_candidate_scan_incomplete: path contains a reparse point".into(),
            );
        }
    }
    fs::canonicalize(path).map_err(|error| {
        format!("folderref_candidate_scan_incomplete: path resolution failed: {error}")
    })
}

pub fn note_link_file_identity(
    path: &Path,
    folder_ref_root: Option<&Path>,
) -> Result<Option<(PathBuf, u64)>, String> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && folder_ref_root.is_none() => {
            return Ok(None)
        }
        Err(error) => {
            return Err(format!(
                "note_link_scan_incomplete: candidate metadata failed: {error}"
            ))
        }
    };
    if !metadata.is_file() {
        return Ok(None);
    }

    let canonical_path = if let Some(root) = folder_ref_root {
        let canonical_root = canonical_path_without_reparse(root)?;
        let canonical_candidate = canonical_path_without_reparse(path)?;
        if !canonical_candidate.starts_with(&canonical_root) {
            return Err("note_link_scan_incomplete: FolderRef candidate escaped its root".into());
        }
        canonical_candidate
    } else {
        fs::canonicalize(path).map_err(|error| {
            format!("note_link_scan_incomplete: candidate identity failed: {error}")
        })?
    };

    Ok(Some((canonical_path, metadata.len())))
}

/// Lists FolderRef descendants without reading file contents. The returned limit
/// is a hard metadata-entry bound; callers can pass remaining_budget + 1 to detect
/// that a broader traversal would be incomplete.
pub fn read_folder_ref_children_bounded(
    root_path: &Path,
    directory_path: &Path,
    limit: usize,
) -> Result<Vec<FsEntry>, String> {
    let canonical_root = canonical_path_without_reparse(root_path)?;
    let root_metadata = fs::metadata(&canonical_root).map_err(|error| {
        format!("folderref_candidate_scan_incomplete: root metadata failed: {error}")
    })?;
    if !root_metadata.is_dir() {
        return Err(
            "folderref_candidate_scan_incomplete: FolderRef root is not a directory".into(),
        );
    }

    let canonical_directory = canonical_path_without_reparse(directory_path)?;
    if !canonical_directory.starts_with(&canonical_root) {
        return Err("folderref_candidate_scan_incomplete: directory escaped FolderRef root".into());
    }
    if !fs::metadata(&canonical_directory)
        .map_err(|error| {
            format!("folderref_candidate_scan_incomplete: directory metadata failed: {error}")
        })?
        .is_dir()
    {
        return Err("folderref_candidate_scan_incomplete: child is not a directory".into());
    }

    let directory = fs::read_dir(&canonical_directory).map_err(|error| {
        format!("folderref_candidate_scan_incomplete: directory read failed: {error}")
    })?;
    let display_path = |canonical_child: &Path| -> Result<String, String> {
        let relative = canonical_child.strip_prefix(&canonical_root).map_err(|_| {
            "folderref_candidate_scan_incomplete: child escaped FolderRef root".to_string()
        })?;
        Ok(normalize_path(&root_path.join(relative).to_string_lossy()))
    };
    let mut children = Vec::new();
    let mut scanned = 0usize;
    for entry in directory {
        let entry = entry.map_err(|error| {
            format!("folderref_candidate_scan_incomplete: directory entry read failed: {error}")
        })?;
        scanned += 1;
        if scanned > limit {
            return Err(
                "folderref_candidate_scan_incomplete: directory entry limit reached".into(),
            );
        }
        let path = entry.path();
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                "folderref_candidate_scan_incomplete: child name is not representable".to_string()
            })?
            .to_string();
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            format!("folderref_candidate_scan_incomplete: child metadata failed: {error}")
        })?;
        if is_reparse_point(&metadata) {
            return Err("folderref_candidate_scan_incomplete: reparse descendant found".into());
        }
        if !metadata.is_dir() && !metadata.is_file() {
            // Preserve the scan count while excluding special files from candidates.
            children.push(FsEntry {
                name,
                path: display_path(&path)?,
                is_dir: false,
                size: None,
                is_text: Some(false),
            });
            continue;
        }

        let canonical_child = fs::canonicalize(&path).map_err(|error| {
            format!("folderref_candidate_scan_incomplete: child resolution failed: {error}")
        })?;
        if !canonical_child.starts_with(&canonical_root) {
            return Err("folderref_candidate_scan_incomplete: child escaped FolderRef root".into());
        }
        let canonical_name = canonical_child
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                "folderref_candidate_scan_incomplete: canonical child name is not representable"
                    .to_string()
            })?
            .to_string();
        children.push(FsEntry {
            name: canonical_name,
            path: display_path(&canonical_child)?,
            is_dir: metadata.is_dir(),
            size: metadata.is_file().then_some(metadata.len()),
            is_text: None,
        });
    }

    children.sort_by(|left, right| {
        if left.is_dir != right.is_dir {
            right.is_dir.cmp(&left.is_dir)
        } else {
            left.name
                .to_ascii_lowercase()
                .cmp(&right.name.to_ascii_lowercase())
                .then_with(|| left.name.cmp(&right.name))
        }
    });
    Ok(children)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;

    #[test]
    fn test_read_children() {
        let temp_dir = tempfile::tempdir().unwrap();
        let path = temp_dir.path();

        // Create a subfolder
        let subfolder = path.join("FolderB");
        fs::create_dir(&subfolder).unwrap();

        // Create another subfolder
        let subfolder_a = path.join("folderA");
        fs::create_dir(&subfolder_a).unwrap();

        // Create some files
        let file_b = path.join("file_b.txt");
        File::create(&file_b).unwrap();
        let file_a = path.join("file_a.txt");
        File::create(&file_a).unwrap();

        let children = read_children(path).unwrap();

        assert_eq!(children.len(), 4);

        // Expect: folderA, FolderB, then file_a.txt, file_b.txt
        assert_eq!(children[0].name, "folderA");
        assert!(children[0].is_dir);

        assert_eq!(children[1].name, "FolderB");
        assert!(children[1].is_dir);

        assert_eq!(children[2].name, "file_a.txt");
        assert!(!children[2].is_dir);

        assert_eq!(children[3].name, "file_b.txt");
        assert!(!children[3].is_dir);
    }

    #[test]
    fn bounded_folder_ref_listing_returns_metadata_without_text_probes() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path();
        fs::write(root.join("Note.md"), "# Note").unwrap();
        fs::write(root.join("binary.bin"), [0, 1, 2]).unwrap();

        let children = read_folder_ref_children_bounded(root, root, 8).unwrap();
        assert_eq!(children.len(), 2);
        let note = children
            .iter()
            .find(|child| child.name == "Note.md")
            .unwrap();
        assert_eq!(note.is_text, None);
        assert_eq!(
            note.path,
            normalize_path(&root.join("Note.md").to_string_lossy())
        );
        assert_eq!(note.size, Some(6));
    }

    #[test]
    fn bounded_folder_ref_listing_fails_when_a_directory_exceeds_its_budget() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path();
        fs::write(root.join("one.md"), "one").unwrap();
        fs::write(root.join("two.md"), "two").unwrap();

        let error = read_folder_ref_children_bounded(root, root, 1).unwrap_err();
        assert!(error.contains("directory entry limit reached"));
    }

    #[test]
    fn bounded_folder_ref_listing_rejects_a_directory_outside_its_root() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let error = read_folder_ref_children_bounded(root.path(), outside.path(), 8).unwrap_err();
        assert!(error.contains("escaped FolderRef root"));
    }

    #[cfg(windows)]
    #[test]
    fn bounded_folder_ref_listing_rejects_a_junction_descendant() {
        use std::process::Command;

        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let junction = root.path().join("external-junction");
        let created = Command::new("cmd.exe")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(
            created.status.success(),
            "could not create a temporary junction: {}",
            String::from_utf8_lossy(&created.stderr)
        );

        let error = read_folder_ref_children_bounded(root.path(), root.path(), 8).unwrap_err();
        assert!(error.contains("reparse"), "{error}");
        std::fs::remove_dir(junction).unwrap();
    }
}
