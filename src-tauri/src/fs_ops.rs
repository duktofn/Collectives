use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
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

    let entries = fs::read_dir(path)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

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
}
