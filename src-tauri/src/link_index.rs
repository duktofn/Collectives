use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use crate::collection::{Collection, Entry};
use tauri::AppHandle;
use tauri::Manager;

pub struct IndexEntry {
    pub display_name: String,
    pub collection_id: String,
    pub entry_id: String,
    pub path: String,
    pub entry_type: String, // "file" or "folder-ref"
}

pub fn init_db_at_path(db_path: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(db_path)
        .map_err(|e| format!("Failed to open SQLite database: {}", e))?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS link_index (
            display_name TEXT NOT NULL,
            collection_id TEXT NOT NULL,
            entry_id TEXT NOT NULL,
            path TEXT NOT NULL,
            entry_type TEXT NOT NULL,
            PRIMARY KEY (collection_id, entry_id)
        )",
        [],
    )
    .map_err(|e| format!("Failed to create link_index table: {}", e))?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_display_name ON link_index(display_name)",
        [],
    )
    .map_err(|e| format!("Failed to create idx_display_name index: {}", e))?;

    Ok(conn)
}

pub fn insert_or_replace_entry(conn: &Connection, entry: &IndexEntry) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO link_index (display_name, collection_id, entry_id, path, entry_type)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            entry.display_name,
            entry.collection_id,
            entry.entry_id,
            entry.path,
            entry.entry_type
        ],
    )
    .map_err(|e| format!("Failed to insert entry: {}", e))?;
    Ok(())
}

pub fn delete_entry(conn: &Connection, collection_id: &str, entry_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM link_index WHERE collection_id = ?1 AND entry_id = ?2",
        params![collection_id, entry_id],
    )
    .map_err(|e| format!("Failed to delete entry: {}", e))?;
    Ok(())
}

pub fn clear_collection_entries(conn: &Connection, collection_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM link_index WHERE collection_id = ?1",
        params![collection_id],
    )
    .map_err(|e| format!("Failed to clear collection: {}", e))?;
    Ok(())
}

pub fn rebuild_index_from_collections(
    conn: &Connection,
    collections: &[Collection],
) -> Result<(), String> {
    conn.execute("DELETE FROM link_index", [])
        .map_err(|e| format!("Failed to clear index for rebuild: {}", e))?;

    let mut all_entries = Vec::new();
    for col in collections {
        extract_index_entries(&col.id, &col.entries, &mut all_entries);
    }

    conn.execute("BEGIN TRANSACTION", [])
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    let mut stmt = conn
        .prepare(
            "INSERT OR REPLACE INTO link_index (display_name, collection_id, entry_id, path, entry_type)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .map_err(|e| format!("Failed to prepare insert statement: {}", e))?;

    for entry in all_entries {
        stmt.execute(params![
            entry.display_name,
            entry.collection_id,
            entry.entry_id,
            entry.path,
            entry.entry_type
        ])
        .map_err(|e| format!("Failed to execute insert inside transaction: {}", e))?;
    }

    conn.execute("COMMIT", [])
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;

    Ok(())
}

pub fn update_index_for_collection(conn: &Connection, collection: &Collection) -> Result<(), String> {
    clear_collection_entries(conn, &collection.id)?;

    let mut all_entries = Vec::new();
    extract_index_entries(&collection.id, &collection.entries, &mut all_entries);

    conn.execute("BEGIN TRANSACTION", [])
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    let mut stmt = conn
        .prepare(
            "INSERT OR REPLACE INTO link_index (display_name, collection_id, entry_id, path, entry_type)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .map_err(|e| format!("Failed to prepare insert statement: {}", e))?;

    for entry in all_entries {
        stmt.execute(params![
            entry.display_name,
            entry.collection_id,
            entry.entry_id,
            entry.path,
            entry.entry_type
        ])
        .map_err(|e| format!("Failed to execute insert inside transaction: {}", e))?;
    }

    conn.execute("COMMIT", [])
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;

    Ok(())
}

fn extract_index_entries(collection_id: &str, entries: &[Entry], out: &mut Vec<IndexEntry>) {
    for entry in entries {
        match entry {
            Entry::File { id, path } => {
                let path_buf = Path::new(path);
                let file_name = path_buf.file_name().and_then(|n| n.to_str()).unwrap_or("");
                let display_name = if path_buf.extension().map_or(false, |ext| ext == "md") {
                    path_buf
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or(file_name)
                        .to_string()
                } else {
                    file_name.to_string()
                };
                out.push(IndexEntry {
                    display_name,
                    collection_id: collection_id.to_string(),
                    entry_id: id.clone(),
                    path: path.clone(),
                    entry_type: "file".to_string(),
                });
            }
            Entry::FolderRef { id, path } => {
                let path_buf = Path::new(path);
                let display_name = path_buf
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();
                out.push(IndexEntry {
                    display_name,
                    collection_id: collection_id.to_string(),
                    entry_id: id.clone(),
                    path: path.clone(),
                    entry_type: "folder-ref".to_string(),
                });
            }
            Entry::Group { children, .. } => {
                extract_index_entries(collection_id, children, out);
            }
        }
    }
}

// Tauri wrappers
pub fn get_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    Ok(app_data.join("link-index.db"))
}

pub fn init_db(app: &AppHandle) -> Result<Connection, String> {
    let path = get_db_path(app)?;
    init_db_at_path(&path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collection::model::{Collection, Entry};

    #[test]
    fn test_link_index_operations() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("link-index.db");

        // Init DB
        let conn = init_db_at_path(&db_path).unwrap();

        // Prepare test data
        let entry1 = IndexEntry {
            display_name: "Note A".to_string(),
            collection_id: "col-1".to_string(),
            entry_id: "entry-1".to_string(),
            path: "d:/notes/Note A.md".to_string(),
            entry_type: "file".to_string(),
        };

        let entry2 = IndexEntry {
            display_name: "Images".to_string(),
            collection_id: "col-1".to_string(),
            entry_id: "entry-2".to_string(),
            path: "d:/notes/images".to_string(),
            entry_type: "folder-ref".to_string(),
        };

        // Insert
        insert_or_replace_entry(&conn, &entry1).unwrap();
        insert_or_replace_entry(&conn, &entry2).unwrap();

        // Query count
        let count: i32 = conn.query_row("SELECT COUNT(*) FROM link_index", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 2);

        // Delete one
        delete_entry(&conn, "col-1", "entry-1").unwrap();
        let count_after_delete: i32 = conn.query_row("SELECT COUNT(*) FROM link_index", [], |row| row.get(0)).unwrap();
        assert_eq!(count_after_delete, 1);

        // Rebuild test
        let col = Collection {
            id: "col-2".to_string(),
            schema_version: 1,
            name: "Rebuild Collection".to_string(),
            created_at: "".to_string(),
            updated_at: "".to_string(),
            entries: vec![
                Entry::File {
                    id: "new-file".to_string(),
                    path: "d:/other/Awesome Note.md".to_string(),
                },
                Entry::Group {
                    id: "virtual-g".to_string(),
                    name: "Group".to_string(),
                    children: vec![
                        Entry::File {
                            id: "nested-file".to_string(),
                            path: "d:/other/Nested.md".to_string(),
                        }
                    ]
                }
            ],
        };

        rebuild_index_from_collections(&conn, &[col]).unwrap();

        // Total count should be 2 (Awesome Note + Nested)
        let final_count: i32 = conn.query_row("SELECT COUNT(*) FROM link_index", [], |row| row.get(0)).unwrap();
        assert_eq!(final_count, 2);

        // Verify nested file resolved name (without extension)
        let resolved_name: String = conn.query_row(
            "SELECT display_name FROM link_index WHERE entry_id = 'nested-file'",
            [],
            |row| row.get(0)
        ).unwrap();
        assert_eq!(resolved_name, "Nested");
    }
}

