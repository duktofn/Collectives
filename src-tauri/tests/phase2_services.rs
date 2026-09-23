use std::sync::Arc;
use tauri_app_lib::application::services::AppServices;
use tauri_app_lib::collection::{archive, import_transaction, manager, Collection, Entry};
use tauri_app_lib::repositories::adapters::SqliteLinkRepository;
use tauri_app_lib::repositories::documents;
use tauri_app_lib::repositories::ports::{CollectionRepository, LinkRepository};

fn assert_send_sync<T: Send + Sync>() {}

#[test]
fn application_services_and_repository_ports_are_send_sync() {
    assert_send_sync::<AppServices>();
    assert_send_sync::<SqliteLinkRepository>();
}

#[test]
fn sqlite_repository_opens_and_drops_a_connection_per_operation() {
    let temp = tempfile::tempdir().unwrap();
    let repository = Arc::new(SqliteLinkRepository::new(temp.path().join("index.db")));
    let first = repository.clone();
    let second = repository.clone();
    std::thread::scope(|scope| {
        let left = scope.spawn(|| {
            first.with_connection(|connection| {
                connection
                    .execute("CREATE TABLE IF NOT EXISTS phase2_probe (id INTEGER)", [])
                    .map_err(|e| e.to_string())?;
                Ok(())
            })
        });
        let right = scope.spawn(|| {
            second.with_connection(|connection| {
                connection
                    .execute("CREATE TABLE IF NOT EXISTS phase2_probe (id INTEGER)", [])
                    .map_err(|e| e.to_string())?;
                Ok(())
            })
        });
        left.join().unwrap().unwrap();
        right.join().unwrap().unwrap();
    });
    assert!(repository.path().exists());
}

#[test]
fn temp_root_service_smoke_keeps_phase1_recovery_guard_and_formats() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("note.md");
    std::fs::write(&source, b"# Phase 2").unwrap();
    let collection = Collection {
        id: "phase2-smoke".into(),
        schema_version: 1,
        name: "Phase 2 Smoke".into(),
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
        entries: vec![Entry::File {
            id: "note".into(),
            path: source.to_string_lossy().into_owned(),
        }],
        metadata: None,
    };
    manager::save_collection_to_path(temp.path(), &collection).unwrap();
    let loaded = manager::load_collection_from_path(temp.path(), &collection.id).unwrap();
    assert_eq!(loaded.id, collection.id);
    let output = temp.path().join("export.zip");
    archive::export_to_zip(temp.path(), &collection.id, &output).unwrap();
    import_transaction::recover(temp.path()).unwrap();
    let snapshot = documents::read_file(source.to_string_lossy().into_owned()).unwrap();
    documents::write_file(
        source.to_string_lossy().into_owned(),
        "# Updated".into(),
        Some(snapshot.version_token),
    )
    .unwrap();
    assert_eq!(std::fs::read_to_string(source).unwrap(), "# Updated");
}

struct FakeCollections {
    values: Vec<Collection>,
}

impl CollectionRepository for FakeCollections {
    fn get_all(&self) -> Result<Vec<Collection>, String> {
        Ok(self.values.clone())
    }
    fn load(&self, _id: &str) -> Result<Collection, String> {
        Err("not used".into())
    }
    fn save(&self, _collection: &Collection) -> Result<(), String> {
        Err("not used".into())
    }
    fn delete(&self, _id: &str) -> Result<(), String> {
        Err("not used".into())
    }
    fn add_entry(
        &self,
        _collection_id: &str,
        _parent_path: &[usize],
        _entry: Entry,
    ) -> Result<(), String> {
        Err("not used".into())
    }
    fn remove_entry(&self, _collection_id: &str, _entry_id: &str) -> Result<Entry, String> {
        Err("not used".into())
    }
    fn move_entry(
        &self,
        _collection_id: &str,
        _entry_id: &str,
        _parent_path: &[usize],
        _new_index: usize,
    ) -> Result<(), String> {
        Err("not used".into())
    }
    fn delete_group_and_promote(
        &self,
        _collection_id: &str,
        _group_id: &str,
    ) -> Result<(), String> {
        Err("not used".into())
    }
}

#[test]
fn collection_service_uses_injected_repository_without_commands_layer() {
    let fake = FakeCollections {
        values: vec![Collection {
            id: "fake".into(),
            schema_version: 1,
            name: "Fake".into(),
            created_at: "".into(),
            updated_at: "".into(),
            entries: Vec::new(),
            metadata: None,
        }],
    };
    let result =
        tauri_app_lib::application::services::get_collections_from_repository(&fake).unwrap();
    assert_eq!(result[0].id, "fake");
}
