pub use crate::application::domain::{
    BrokenEntry, Collection, CustomFont, Entry, FileSnapshot, FsEntry, ResolveCandidate, Settings,
    ZipConflict,
};
use crate::metadata::{SqliteMetadataLinkRepository, SqliteMetadataRepository};
use crate::repositories::adapters::{
    AppFilesystemRepository, AppSettingsRepository, ArchiveRepository as ArchiveAdapter,
    DocumentFileRepository,
};
use crate::repositories::ports::{
    ArchiveRepository, CollectionRepository, DocumentRepository, FilesystemRepository,
    LinkRepository, MetadataRepository, SettingsRepository,
};
use crate::safety_error::SafetyError;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppServices {
    pub collections: Arc<dyn CollectionRepository>,
    pub archive: Arc<dyn ArchiveRepository>,
    pub documents: Arc<dyn DocumentRepository>,
    pub settings: Arc<dyn SettingsRepository>,
    pub links: Arc<dyn LinkRepository>,
    pub filesystem: Arc<dyn FilesystemRepository>,
    pub metadata: Option<Arc<dyn MetadataRepository>>,
    pub app: Option<tauri::AppHandle>,
}

impl AppServices {
    pub fn from_app(app: &tauri::AppHandle) -> Result<Self, String> {
        let sqlite_metadata = Arc::new(SqliteMetadataRepository::from_app(app)?);
        let collections_dir = sqlite_metadata.collections_dir().to_path_buf();
        let collections = sqlite_metadata.clone();
        let archive = Arc::new(ArchiveAdapter::new(app));
        let documents = Arc::new(DocumentFileRepository);
        let settings = Arc::new(AppSettingsRepository::new(app));
        let links = Arc::new(SqliteMetadataLinkRepository::new(&collections_dir));
        let filesystem = Arc::new(AppFilesystemRepository::new(app));
        Ok(Self {
            collections,
            archive,
            documents,
            settings,
            links,
            filesystem,
            metadata: Some(sqlite_metadata),
            app: Some(app.clone()),
        })
    }

    pub fn from_repositories(
        collections: Arc<dyn CollectionRepository>,
        archive: Arc<dyn ArchiveRepository>,
        documents: Arc<dyn DocumentRepository>,
        settings: Arc<dyn SettingsRepository>,
        links: Arc<dyn LinkRepository>,
        filesystem: Arc<dyn FilesystemRepository>,
    ) -> Self {
        Self {
            collections,
            archive,
            documents,
            settings,
            links,
            filesystem,
            metadata: None,
            app: None,
        }
    }
}

fn update_collection_index(services: &AppServices, collection_id: &str) {
    if let Ok(collection) = services.collections.load(collection_id) {
        let _ = services.links.update_collection(&collection);
    }
}

pub fn get_collections(services: &AppServices) -> Result<Vec<Collection>, String> {
    services.collections.get_all()
}

pub fn apply_collection_mutation_v2(
    services: &AppServices,
    request: crate::metadata::MutationRequest,
) -> Result<crate::metadata::MutationResult, SafetyError> {
    let result = services
        .metadata
        .as_ref()
        .ok_or_else(|| {
            SafetyError::new(
                "metadata_unavailable",
                "SQLite metadata service is unavailable",
            )
        })?
        .apply_mutation(request)?;
    if let Some(app) = &services.app {
        use tauri::Emitter;
        app.emit(
            "collection-delta-v2",
            crate::ipc::dto::CollectionDeltaV2 {
                collection_id: result.collection_id.clone(),
                revision: result.revision,
                mutation_id: result.mutation_id.clone(),
                changes: result.changes.clone(),
                origin: "ui".to_string(),
            },
        )
        .map_err(|error| SafetyError::new("metadata_event_failed", error.to_string()))?;
    }
    Ok(result)
}

pub fn migration_status(
    services: &AppServices,
) -> Result<crate::metadata::MigrationStatus, SafetyError> {
    services
        .metadata
        .as_ref()
        .ok_or_else(|| {
            SafetyError::new(
                "metadata_unavailable",
                "SQLite metadata service is unavailable",
            )
        })?
        .migration_status()
}

pub fn migration_retry(
    services: &AppServices,
) -> Result<crate::metadata::MigrationStatus, SafetyError> {
    services
        .metadata
        .as_ref()
        .ok_or_else(|| {
            SafetyError::new(
                "metadata_unavailable",
                "SQLite metadata service is unavailable",
            )
        })?
        .retry_migration()
}

pub fn reconcile_collection_snapshot(
    services: &AppServices,
    state: &tauri::State<'_, crate::fs_layer::watcher::WatchState>,
    collection_id: String,
    specs: Vec<crate::fs_layer::watcher::WatchSpec>,
) -> Result<crate::metadata::MetadataSnapshot, SafetyError> {
    let cursor = services
        .filesystem
        .sync_collection_watches(state, &collection_id, &specs)
        .map_err(SafetyError::from)?;
    services
        .metadata
        .as_ref()
        .ok_or_else(|| {
            SafetyError::new(
                "metadata_unavailable",
                "SQLite metadata service is unavailable",
            )
        })?
        .snapshot(&collection_id, cursor)
}

pub fn get_collections_from_repository(
    repository: &dyn CollectionRepository,
) -> Result<Vec<Collection>, String> {
    repository.get_all()
}

pub fn create_collection(services: &AppServices, name: String) -> Result<Collection, String> {
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let collection = Collection {
        id: uuid::Uuid::new_v4().to_string(),
        schema_version: 1,
        name,
        created_at: now.clone(),
        updated_at: now,
        entries: Vec::new(),
        metadata: None,
    };
    services.collections.save(&collection)?;
    Ok(collection)
}

pub fn update_collection(services: &AppServices, mut collection: Collection) -> Result<(), String> {
    collection.updated_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    services.collections.save(&collection)?;
    services.links.update_collection(&collection)
}

pub fn delete_collection(services: &AppServices, id: String) -> Result<(), String> {
    services.collections.delete(&id)?;
    services.links.clear_collection(&id)
}

pub fn load_settings(services: &AppServices) -> Settings {
    services.settings.load()
}

pub fn save_settings(services: &AppServices, settings: Settings) -> Result<(), String> {
    services.settings.save(settings)
}

pub fn read_folder_children(services: &AppServices, path: String) -> Result<Vec<FsEntry>, String> {
    services.filesystem.read_children(&path)
}

pub fn add_entry(
    services: &AppServices,
    collection_id: String,
    parent_path: Vec<usize>,
    entry: Entry,
) -> Result<(), String> {
    services
        .collections
        .add_entry(&collection_id, &parent_path, entry)?;
    update_collection_index(services, &collection_id);
    Ok(())
}

pub fn remove_entry(
    services: &AppServices,
    collection_id: String,
    entry_id: String,
) -> Result<Entry, String> {
    let removed = services
        .collections
        .remove_entry(&collection_id, &entry_id)?;
    update_collection_index(services, &collection_id);
    Ok(removed)
}

pub fn delete_group_and_promote(
    services: &AppServices,
    collection_id: String,
    group_id: String,
) -> Result<(), String> {
    services
        .collections
        .delete_group_and_promote(&collection_id, &group_id)
}

pub fn move_entry(
    services: &AppServices,
    collection_id: String,
    entry_id: String,
    parent_path: Vec<usize>,
    new_index: usize,
) -> Result<(), String> {
    services
        .collections
        .move_entry(&collection_id, &entry_id, &parent_path, new_index)?;
    update_collection_index(services, &collection_id);
    Ok(())
}

pub fn create_group(
    services: &AppServices,
    collection_id: String,
    name: String,
    parent_path: Vec<usize>,
) -> Result<Entry, String> {
    let entry = Entry::Group {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        children: Vec::new(),
    };
    services
        .collections
        .add_entry(&collection_id, &parent_path, entry.clone())?;
    update_collection_index(services, &collection_id);
    Ok(entry)
}

pub fn rename_group(
    services: &AppServices,
    collection_id: String,
    group_id: String,
    new_name: String,
) -> Result<(), String> {
    let mut collection = services.collections.load(&collection_id)?;
    fn rename(entries: &mut [Entry], group_id: &str, name: &str) -> bool {
        for entry in entries {
            if let Entry::Group {
                id,
                name: current,
                children,
            } = entry
            {
                if id == group_id {
                    *current = name.to_string();
                    return true;
                }
                if rename(children, group_id, name) {
                    return true;
                }
            }
        }
        false
    }
    if !rename(&mut collection.entries, &group_id, &new_name) {
        return Err(format!("Group with ID {} not found", group_id));
    }
    collection.updated_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    services.collections.save(&collection)
}

pub fn add_file_entries(
    services: &AppServices,
    collection_id: String,
    paths: Vec<String>,
) -> Result<Vec<Entry>, String> {
    let mut added = Vec::new();
    for path in paths {
        let entry = Entry::File {
            id: uuid::Uuid::new_v4().to_string(),
            path: services.filesystem.normalize(&path),
        };
        services
            .collections
            .add_entry(&collection_id, &[], entry.clone())?;
        added.push(entry);
    }
    update_collection_index(services, &collection_id);
    Ok(added)
}

pub fn add_folder_ref(
    services: &AppServices,
    collection_id: String,
    path: String,
) -> Result<Entry, String> {
    let entry = Entry::FolderRef {
        id: uuid::Uuid::new_v4().to_string(),
        path: services.filesystem.normalize(&path),
    };
    services
        .collections
        .add_entry(&collection_id, &[], entry.clone())?;
    update_collection_index(services, &collection_id);
    Ok(entry)
}

pub async fn validate_entries(
    services: &AppServices,
    collection_id: String,
) -> Result<Vec<BrokenEntry>, String> {
    let mut collection = services.collections.load(&collection_id)?;
    let mut entries = Vec::new();
    fn collect(entries: &[Entry], output: &mut Vec<(String, String, bool)>) {
        for entry in entries {
            match entry {
                Entry::File { id, path } => output.push((id.clone(), path.clone(), true)),
                Entry::FolderRef { id, path } => output.push((id.clone(), path.clone(), false)),
                Entry::Group { children, .. } => collect(children, output),
            }
        }
    }
    collect(&collection.entries, &mut entries);
    let filesystem = services.filesystem.clone();
    let mut tasks = Vec::new();
    for (id, path, is_file) in entries {
        let filesystem = filesystem.clone();
        tasks.push(tokio::task::spawn_blocking(move || {
            if !filesystem.exists(&path) {
                Some(BrokenEntry {
                    id,
                    path,
                    reason: if is_file {
                        "File not found".into()
                    } else {
                        "Folder not found".into()
                    },
                })
            } else {
                None
            }
        }));
    }
    let mut broken = Vec::new();
    for task in tasks {
        if let Ok(Some(entry)) = task.await {
            broken.push(entry);
        }
    }
    collection.metadata = Some(crate::application::domain::CollectionMetadata {
        last_validated_at: Some(
            chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        ),
        broken_entry_ids: broken.iter().map(|entry| entry.id.clone()).collect(),
    });
    services.collections.save(&collection)?;
    Ok(broken)
}

pub fn read_file(services: &AppServices, path: String) -> Result<FileSnapshot, SafetyError> {
    services.documents.read(&path)
}

pub fn read_folderref_snapshot(
    services: &AppServices,
    root_path: String,
    child_path: String,
) -> Result<FileSnapshot, SafetyError> {
    services
        .documents
        .read_folderref_snapshot(&root_path, &child_path)
}

pub fn write_file(
    services: &AppServices,
    path: String,
    content: String,
    expected_token: Option<String>,
) -> Result<crate::repositories::documents::DocumentWriteReceipt, SafetyError> {
    services.documents.write(&path, &content, expected_token)
}

pub fn resolve_wikilink(
    services: &AppServices,
    collection_id: String,
    note_name: String,
) -> Result<Option<ResolveCandidate>, String> {
    Ok(services
        .links
        .resolve(&collection_id, &note_name)?
        .map(|entry| ResolveCandidate {
            display_name: entry.display_name,
            entry_id: entry.entry_id,
            path: entry.path,
            entry_type: entry.entry_type,
        }))
}

pub fn search_link_index(
    services: &AppServices,
    collection_id: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<ResolveCandidate>, String> {
    Ok(services
        .links
        .search(&collection_id, &query, limit.unwrap_or(20))?
        .into_iter()
        .map(|entry| ResolveCandidate {
            display_name: entry.display_name,
            entry_id: entry.entry_id,
            path: entry.path,
            entry_type: entry.entry_type,
        })
        .collect())
}

pub fn import_folder(
    services: &AppServices,
    path: String,
    name: String,
) -> Result<Collection, String> {
    let collection = services.archive.import_folder(&path, &name)?;
    services.collections.save(&collection)?;
    Ok(collection)
}

pub fn export_collection_to_folder(
    services: &AppServices,
    collection_id: String,
    destination: String,
) -> Result<(), SafetyError> {
    services
        .archive
        .export_folder(&collection_id, &destination)
        .map_err(SafetyError::from)
}

pub fn export_collection_to_zip(
    services: &AppServices,
    collection_id: String,
    destination: String,
) -> Result<(), SafetyError> {
    services
        .archive
        .export_zip(&collection_id, &destination)
        .map_err(SafetyError::from)
}

pub fn check_zip_conflicts(
    services: &AppServices,
    zip_path: String,
    destination: String,
) -> Result<Vec<ZipConflict>, SafetyError> {
    services
        .archive
        .check_zip_conflicts(&zip_path, &destination)
        .map_err(SafetyError::from)
}

pub fn import_zip(
    services: &AppServices,
    zip_path: String,
    destination: String,
    resolutions: std::collections::HashMap<String, String>,
) -> Result<Collection, SafetyError> {
    let collection = services
        .archive
        .import_zip(&zip_path, &destination, resolutions)
        .map_err(SafetyError::from)?;
    services
        .collections
        .save(&collection)
        .map_err(SafetyError::from)?;
    services.links.update_collection(&collection).ok();
    Ok(collection)
}

pub fn import_font(
    services: &AppServices,
    source: String,
    family: String,
    weight: String,
    style: String,
) -> Result<CustomFont, String> {
    services
        .settings
        .import_font(&source, &family, &weight, &style)
}

pub fn delete_font(services: &AppServices, file_name: String) -> Result<(), String> {
    services.settings.delete_font(&file_name)
}

pub fn get_fonts_dir(services: &AppServices) -> Result<String, String> {
    services.settings.fonts_dir()
}

pub fn export_theme(
    services: &AppServices,
    settings: Settings,
    destination: String,
) -> Result<(), String> {
    services.settings.export_theme(&settings, &destination)
}

pub fn import_theme(services: &AppServices, path: String) -> Result<Settings, String> {
    services.settings.import_theme(&path)
}

pub fn watch_entry(
    services: &AppServices,
    state: &tauri::State<'_, crate::fs_layer::watcher::WatchState>,
    path: String,
    entry_id: String,
) -> Result<(), String> {
    services.filesystem.watch_entry(state, &path, &entry_id)
}

pub fn unwatch_entry(
    services: &AppServices,
    state: &tauri::State<'_, crate::fs_layer::watcher::WatchState>,
    path: String,
) -> Result<(), String> {
    services.filesystem.unwatch_entry(state, &path)
}

pub fn watch_folder(
    services: &AppServices,
    state: &tauri::State<'_, crate::fs_layer::watcher::WatchState>,
    path: String,
    entry_id: String,
) -> Result<(), String> {
    services.filesystem.watch_folder(state, &path, &entry_id)
}

pub fn unwatch_folder(
    services: &AppServices,
    state: &tauri::State<'_, crate::fs_layer::watcher::WatchState>,
    path: String,
) -> Result<(), String> {
    services.filesystem.unwatch_folder(state, &path)
}

pub fn clear_watches(
    services: &AppServices,
    state: &tauri::State<'_, crate::fs_layer::watcher::WatchState>,
) -> Result<(), String> {
    services.filesystem.clear_watches(state)
}

pub fn sync_collection_watches(
    services: &AppServices,
    state: &tauri::State<'_, crate::fs_layer::watcher::WatchState>,
    collection_id: String,
    specs: Vec<crate::fs_layer::watcher::WatchSpec>,
) -> Result<crate::fs_layer::watcher::WatchCursor, String> {
    services
        .filesystem
        .sync_collection_watches(state, &collection_id, &specs)
}

pub fn initialize_identity_cache(
    services: &AppServices,
    cache: &tauri::State<'_, crate::fs_layer::file_identity::FileIdentityCache>,
    collection_id: String,
) -> Result<(), String> {
    services
        .filesystem
        .initialize_identity_cache(cache, &collection_id)
}

pub fn detect_moved_entry(
    services: &AppServices,
    cache: &tauri::State<'_, crate::fs_layer::file_identity::FileIdentityCache>,
    collection_id: String,
    entry_id: String,
    old_path: String,
) -> Result<Option<String>, String> {
    services
        .filesystem
        .detect_moved_entry(cache, &collection_id, &entry_id, &old_path)
}
