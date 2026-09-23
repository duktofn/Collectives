use crate::collection::{Collection, Entry};
use crate::safety_error::SafetyError;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LegacyCollectionRow {
    pub id: String,
    pub name: String,
    pub name_key: String,
    pub created_at: String,
    pub updated_at: String,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LegacyEntryRow {
    pub collection_id: String,
    pub id: String,
    pub parent_id: Option<String>,
    pub entry_type: String,
    pub name: Option<String>,
    pub path: Option<String>,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LegacyIndexRow {
    pub collection_id: String,
    pub entry_id: String,
    pub display_name: String,
    pub path: String,
    pub entry_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LegacySnapshot {
    pub source_files: Vec<String>,
    pub collections: Vec<LegacyCollectionRow>,
    pub entries: Vec<LegacyEntryRow>,
    pub index: Vec<LegacyIndexRow>,
    pub source_digest: String,
}

pub fn simple_name_key(name: &str) -> String {
    name.to_lowercase()
}

pub fn flatten_collection(
    collection: &Collection,
) -> Result<(Vec<LegacyEntryRow>, Vec<LegacyIndexRow>), SafetyError> {
    let mut entries = Vec::new();
    let mut index = Vec::new();
    flatten_entries(
        &collection.id,
        None,
        &collection.entries,
        &mut entries,
        &mut index,
    )?;
    validate_entry_rows(&entries)?;
    Ok((entries, index))
}

pub fn load_authoritative_snapshot(collections_dir: &Path) -> Result<LegacySnapshot, SafetyError> {
    let mut files = Vec::<PathBuf>::new();
    if collections_dir.exists() {
        for item in fs::read_dir(collections_dir).map_err(|error| {
            SafetyError::new(
                "metadata_source_read_failed",
                format!("cannot read collections directory: {error}"),
            )
        })? {
            let path = item
                .map_err(|error| {
                    SafetyError::new("metadata_source_read_failed", error.to_string())
                })?
                .path();
            if path.is_file()
                && path
                    .extension()
                    .is_some_and(|extension| extension == "json")
                && path.file_name().and_then(|name| name.to_str()) != Some("settings.json")
            {
                files.push(path);
            }
        }
    }
    files.sort();

    let mut collections = Vec::with_capacity(files.len());
    let mut entries = Vec::new();
    let mut index = Vec::new();
    let mut collection_ids = HashSet::new();
    let mut collection_names = HashMap::new();
    let mut source_files = Vec::with_capacity(files.len());

    for path in files {
        let data = fs::read(&path).map_err(|error| {
            SafetyError::new(
                "metadata_source_read_failed",
                format!("{}: {error}", path.display()),
            )
        })?;
        let collection: Collection = serde_json::from_slice(&data).map_err(|error| {
            SafetyError::new("metadata_malformed", format!("{}: {error}", path.display()))
        })?;
        if collection.id.is_empty() || collection.name.is_empty() {
            return Err(SafetyError::new(
                "metadata_invalid_collection",
                "collection id and name must be non-empty",
            ));
        }
        if !collection_ids.insert(collection.id.clone()) {
            return Err(SafetyError::new(
                "metadata_duplicate_id",
                format!("duplicate collection id {}", collection.id),
            ));
        }
        let name_key = simple_name_key(&collection.name);
        if let Some(previous) = collection_names.insert(name_key.clone(), collection.id.clone()) {
            return Err(SafetyError::new(
                "metadata_name_collision",
                format!(
                    "collection names {} and {} collide under simple lowercase",
                    previous, collection.id
                ),
            ));
        }
        let metadata_json = collection
            .metadata
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| SafetyError::new("metadata_serialize_failed", error.to_string()))?;
        collections.push(LegacyCollectionRow {
            id: collection.id.clone(),
            name: collection.name.clone(),
            name_key,
            created_at: collection.created_at.clone(),
            updated_at: collection.updated_at.clone(),
            metadata_json,
        });
        let (mut collection_entries, mut collection_index) = flatten_collection(&collection)?;
        entries.append(&mut collection_entries);
        index.append(&mut collection_index);
        source_files.push(path.to_string_lossy().into_owned());
    }

    validate_entry_rows(&entries)?;
    let canonical = serde_json::to_vec(&(&source_files, &collections, &entries, &index))
        .map_err(|error| SafetyError::new("metadata_serialize_failed", error.to_string()))?;
    Ok(LegacySnapshot {
        source_files,
        collections,
        entries,
        index,
        source_digest: blake3::hash(&canonical).to_hex().to_string(),
    })
}

pub fn validate_entry_rows(rows: &[LegacyEntryRow]) -> Result<(), SafetyError> {
    let mut identities = HashSet::<(String, String)>::new();
    let mut children = HashMap::<(String, Option<String>), HashSet<i64>>::new();
    let identities_set: HashSet<(String, String)> = rows
        .iter()
        .map(|row| (row.collection_id.clone(), row.id.clone()))
        .collect();
    if identities_set.len() != rows.len() {
        return Err(SafetyError::new(
            "metadata_duplicate_entry_id",
            "duplicate entry id within a collection",
        ));
    }
    for row in rows {
        if row.id.is_empty() || row.collection_id.is_empty() || row.sort_order < 0 {
            return Err(SafetyError::new(
                "metadata_invalid_entry",
                "entry identity and non-negative sort order are required",
            ));
        }
        if let Some(parent_id) = &row.parent_id {
            if !identities_set.contains(&(row.collection_id.clone(), parent_id.clone())) {
                return Err(SafetyError::new(
                    "metadata_orphan_entry",
                    format!("{} has missing parent {}", row.id, parent_id),
                ));
            }
        }
        if !identities.insert((row.collection_id.clone(), row.id.clone())) {
            return Err(SafetyError::new(
                "metadata_duplicate_entry_id",
                row.id.clone(),
            ));
        }
        let key = (row.collection_id.clone(), row.parent_id.clone());
        if !children.entry(key).or_default().insert(row.sort_order) {
            return Err(SafetyError::new(
                "metadata_duplicate_order",
                format!("duplicate sibling sort order for {}", row.id),
            ));
        }
    }
    for row in rows {
        let mut seen = HashSet::new();
        let mut current = Some(row.id.clone());
        while let Some(id) = current {
            if !seen.insert(id.clone()) {
                return Err(SafetyError::new(
                    "metadata_cycle",
                    format!("cycle reaches {id}"),
                ));
            }
            current = rows
                .iter()
                .find(|candidate| {
                    candidate.collection_id == row.collection_id && candidate.id == id
                })
                .and_then(|candidate| candidate.parent_id.clone());
        }
    }
    Ok(())
}

fn flatten_entries(
    collection_id: &str,
    parent_id: Option<&str>,
    entries: &[Entry],
    rows: &mut Vec<LegacyEntryRow>,
    index: &mut Vec<LegacyIndexRow>,
) -> Result<(), SafetyError> {
    for (sort_order, entry) in entries.iter().enumerate() {
        let (id, entry_type, name, path) = match entry {
            Entry::File { id, path } => (id, "file", None, Some(path)),
            Entry::FolderRef { id, path } => (id, "folder-ref", None, Some(path)),
            Entry::Group { id, name, .. } => (id, "group", Some(name), None),
        };
        if id.is_empty() {
            return Err(SafetyError::new(
                "metadata_invalid_entry",
                "entry id must be non-empty",
            ));
        }
        rows.push(LegacyEntryRow {
            collection_id: collection_id.to_string(),
            id: id.clone(),
            parent_id: parent_id.map(str::to_string),
            entry_type: entry_type.to_string(),
            name: name.cloned(),
            path: path.cloned(),
            sort_order: sort_order as i64,
        });
        if let Some(path) = path {
            index.push(LegacyIndexRow {
                collection_id: collection_id.to_string(),
                entry_id: id.clone(),
                display_name: display_name(path, entry_type),
                path: path.clone(),
                entry_type: entry_type.to_string(),
            });
        }
        if let Entry::Group { children, .. } = entry {
            flatten_entries(collection_id, Some(id), children, rows, index)?;
        }
    }
    Ok(())
}

fn display_name(path: &str, entry_type: &str) -> String {
    let path = Path::new(path);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if entry_type == "file" && path.extension().is_some_and(|extension| extension == "md") {
        path.file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or(file_name)
            .to_string()
    } else {
        file_name.to_string()
    }
}

pub fn reconstruct_entries(
    rows: &[LegacyEntryRow],
    collection_id: &str,
) -> Result<Vec<Entry>, SafetyError> {
    validate_entry_rows(rows)?;
    let mut by_parent: HashMap<Option<String>, Vec<&LegacyEntryRow>> = HashMap::new();
    for row in rows.iter().filter(|row| row.collection_id == collection_id) {
        by_parent
            .entry(row.parent_id.clone())
            .or_default()
            .push(row);
    }
    for siblings in by_parent.values_mut() {
        siblings.sort_by_key(|row| (row.sort_order, row.id.clone()));
    }
    fn build(
        parent: Option<&str>,
        by_parent: &HashMap<Option<String>, Vec<&LegacyEntryRow>>,
    ) -> Result<Vec<Entry>, SafetyError> {
        by_parent
            .get(&parent.map(str::to_string))
            .unwrap_or(&Vec::new())
            .iter()
            .map(|row| match row.entry_type.as_str() {
                "file" => Ok(Entry::File {
                    id: row.id.clone(),
                    path: row.path.clone().ok_or_else(|| {
                        SafetyError::new("metadata_invalid_entry", "file path missing")
                    })?,
                }),
                "folder-ref" => Ok(Entry::FolderRef {
                    id: row.id.clone(),
                    path: row.path.clone().ok_or_else(|| {
                        SafetyError::new("metadata_invalid_entry", "folder path missing")
                    })?,
                }),
                "group" => Ok(Entry::Group {
                    id: row.id.clone(),
                    name: row.name.clone().ok_or_else(|| {
                        SafetyError::new("metadata_invalid_entry", "group name missing")
                    })?,
                    children: build(Some(&row.id), by_parent)?,
                }),
                _ => Err(SafetyError::new(
                    "metadata_invalid_entry",
                    format!("unknown entry type {}", row.entry_type),
                )),
            })
            .collect()
    }
    build(None, &by_parent)
}
