use crate::collection::model::Collection;
use crate::collection::model::Entry;
use crate::fs_layer::file_identity::FileIdentityCache;
use crate::fs_layer::watcher::WatchState;
use crate::fs_ops::FsEntry;
use crate::repositories::documents::DocumentSnapshot;
use crate::repositories::ports::{
    ArchiveRepository as ArchiveRepositoryPort, CollectionRepository as CollectionRepositoryPort,
    DocumentRepository, FilesystemRepository, LinkRepository, SettingsRepository,
};
use crate::safety_error::SafetyError;
use crate::settings::{CustomFont, Settings};
use crate::{collection, link_index};
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Clone)]
pub struct JsonCollectionRepository {
    app: AppHandle,
}

impl JsonCollectionRepository {
    pub fn new(app: &AppHandle) -> Self {
        Self { app: app.clone() }
    }
    pub fn get_all(&self) -> Result<Vec<Collection>, String> {
        collection::get_all_collections(&self.app)
    }
    pub fn save(&self, collection: &Collection) -> Result<(), String> {
        collection::save_collection(&self.app, collection)
    }
}

impl CollectionRepositoryPort for JsonCollectionRepository {
    fn get_all(&self) -> Result<Vec<Collection>, String> {
        collection::get_all_collections(&self.app)
    }
    fn load(&self, id: &str) -> Result<Collection, String> {
        collection::load_collection(&self.app, id)
    }
    fn save(&self, collection: &Collection) -> Result<(), String> {
        collection::save_collection(&self.app, collection)
    }
    fn delete(&self, id: &str) -> Result<(), String> {
        collection::delete_collection(&self.app, id)
    }
    fn add_entry(
        &self,
        collection_id: &str,
        parent_path: &[usize],
        entry: Entry,
    ) -> Result<(), String> {
        collection::add_entry_to_collection(&self.app, collection_id, parent_path, entry)
    }
    fn remove_entry(&self, collection_id: &str, entry_id: &str) -> Result<Entry, String> {
        collection::remove_entry_from_collection(&self.app, collection_id, entry_id)
    }
    fn move_entry(
        &self,
        collection_id: &str,
        entry_id: &str,
        parent_path: &[usize],
        new_index: usize,
    ) -> Result<(), String> {
        collection::move_entry_in_collection(
            &self.app,
            collection_id,
            entry_id,
            parent_path,
            new_index,
        )
    }
    fn delete_group_and_promote(&self, collection_id: &str, group_id: &str) -> Result<(), String> {
        let dir = collection::get_collections_dir(&self.app)?;
        collection::manager::delete_group_and_promote_to_collection_path(
            &dir,
            collection_id,
            group_id,
        )
    }
}

#[derive(Clone)]
pub struct ArchiveRepository {
    app: AppHandle,
}

impl ArchiveRepository {
    pub fn new(app: &AppHandle) -> Self {
        Self { app: app.clone() }
    }
    pub fn app(&self) -> &AppHandle {
        &self.app
    }
}

impl ArchiveRepositoryPort for ArchiveRepository {
    fn import_folder(&self, path: &str, name: &str) -> Result<Collection, String> {
        let dir = collection::get_collections_dir(&self.app)?;
        collection::archive::import_folder(&dir, Path::new(path), name)
    }
    fn export_folder(&self, collection_id: &str, destination: &str) -> Result<(), String> {
        let dir = collection::get_collections_dir(&self.app)?;
        collection::archive::export_to_folder(&dir, collection_id, Path::new(destination))
    }
    fn export_zip(&self, collection_id: &str, destination: &str) -> Result<(), String> {
        let dir = collection::get_collections_dir(&self.app)?;
        collection::archive::export_to_zip(&dir, collection_id, Path::new(destination))
    }
    fn check_zip_conflicts(
        &self,
        zip_path: &str,
        destination: &str,
    ) -> Result<Vec<crate::collection::archive::ZipConflict>, String> {
        collection::archive::check_zip_conflicts(Path::new(zip_path), Path::new(destination))
    }
    fn import_zip(
        &self,
        zip_path: &str,
        destination: &str,
        resolutions: std::collections::HashMap<String, String>,
    ) -> Result<Collection, String> {
        let dir = collection::get_collections_dir(&self.app)?;
        collection::archive::import_zip(
            &dir,
            Path::new(zip_path),
            Path::new(destination),
            resolutions,
        )
    }
}

#[derive(Clone)]
pub struct SqliteLinkRepository {
    db_path: PathBuf,
}

impl SqliteLinkRepository {
    pub fn new(db_path: impl Into<PathBuf>) -> Self {
        Self {
            db_path: db_path.into(),
        }
    }

    pub fn from_app(app: &AppHandle) -> Result<Self, String> {
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        Ok(Self::new(app_data.join("link-index.db")))
    }

    pub fn with_connection<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let connection = link_index::init_db_at_path(&self.db_path)?;
        operation(&connection)
    }

    pub fn update_collection(&self, collection: &Collection) -> Result<(), String> {
        self.with_connection(|connection| {
            link_index::update_index_for_collection(connection, collection)
        })
    }

    pub fn clear_collection(&self, collection_id: &str) -> Result<(), String> {
        self.with_connection(|connection| {
            link_index::clear_collection_entries(connection, collection_id)
        })
    }

    pub fn resolve(
        &self,
        collection_id: &str,
        note_name: &str,
    ) -> Result<Option<link_index::IndexEntry>, String> {
        self.with_connection(|connection| {
            link_index::resolve_by_name(connection, collection_id, note_name)
        })
    }

    pub fn search(
        &self,
        collection_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<link_index::IndexEntry>, String> {
        self.with_connection(|connection| {
            link_index::search_by_name(connection, collection_id, query, limit)
        })
    }
}

impl LinkRepository for SqliteLinkRepository {
    fn update_collection(&self, collection: &Collection) -> Result<(), String> {
        self.update_collection(collection)
    }
    fn clear_collection(&self, collection_id: &str) -> Result<(), String> {
        self.clear_collection(collection_id)
    }
    fn resolve(
        &self,
        collection_id: &str,
        note_name: &str,
    ) -> Result<Option<link_index::IndexEntry>, String> {
        self.resolve(collection_id, note_name)
    }
    fn search(
        &self,
        collection_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<link_index::IndexEntry>, String> {
        self.search(collection_id, query, limit)
    }
    fn path(&self) -> &Path {
        &self.db_path
    }
}

#[derive(Clone)]
pub struct DocumentFileRepository;

impl DocumentRepository for DocumentFileRepository {
    fn read(&self, path: &str) -> Result<DocumentSnapshot, SafetyError> {
        crate::repositories::documents::read_file(path.to_string())
    }

    fn read_folderref_snapshot(
        &self,
        root_path: &str,
        child_path: &str,
    ) -> Result<DocumentSnapshot, SafetyError> {
        crate::repositories::documents::read_folderref_snapshot(
            root_path.to_string(),
            child_path.to_string(),
        )
    }
    fn write(
        &self,
        path: &str,
        content: &str,
        expected_token: Option<String>,
    ) -> Result<crate::repositories::documents::DocumentWriteReceipt, SafetyError> {
        crate::repositories::documents::write_file(
            path.to_string(),
            content.to_string(),
            expected_token,
        )
    }

    fn create_new(
        &self,
        path: &str,
        content: &str,
    ) -> Result<crate::repositories::documents::DocumentWriteReceipt, SafetyError> {
        crate::repositories::documents::create_file(path.to_string(), content.to_string())
    }
}

#[derive(Clone)]
pub struct AppSettingsRepository {
    app: AppHandle,
}

impl AppSettingsRepository {
    pub fn new(app: &AppHandle) -> Self {
        Self { app: app.clone() }
    }
    fn app_data(&self) -> Result<PathBuf, String> {
        self.app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())
    }
}

impl SettingsRepository for AppSettingsRepository {
    fn load(&self) -> Settings {
        crate::settings::load_settings(&self.app)
    }
    fn save(&self, settings: Settings) -> Result<(), String> {
        crate::settings::save_settings(&self.app, settings)
    }
    fn import_font(
        &self,
        source: &str,
        family: &str,
        weight: &str,
        style: &str,
    ) -> Result<CustomFont, String> {
        let dir = self.app_data()?;
        crate::font_manager::import_font(&dir, Path::new(source), family, weight, style)
    }
    fn import_font_base64(
        &self,
        preferred_file_name: &str,
        family: &str,
        weight: &str,
        style: &str,
        data_base64: &str,
    ) -> Result<CustomFont, String> {
        crate::font_manager::import_font_base64(
            &self.app_data()?,
            preferred_file_name,
            family,
            weight,
            style,
            data_base64,
        )
    }
    fn delete_font(&self, file_name: &str) -> Result<(), String> {
        crate::font_manager::delete_font(&self.app_data()?, file_name)
    }
    fn fonts_dir(&self) -> Result<String, String> {
        Ok(crate::font_manager::get_fonts_dir(&self.app_data()?)
            .to_string_lossy()
            .into_owned())
    }
    fn export_theme(&self, settings: &Settings, destination: &str) -> Result<(), String> {
        crate::theme_io::export_theme(&self.app_data()?, settings, Path::new(destination))
    }
    fn import_theme(&self, path: &str) -> Result<crate::theme_io::ImportedTheme, String> {
        crate::theme_io::import_theme(&self.app_data()?, Path::new(path))
    }
}

#[derive(Clone)]
pub struct AppFilesystemRepository {
    app: AppHandle,
}

impl AppFilesystemRepository {
    pub fn new(app: &AppHandle) -> Self {
        Self { app: app.clone() }
    }
}

impl FilesystemRepository for AppFilesystemRepository {
    fn read_children(&self, path: &str) -> Result<Vec<FsEntry>, String> {
        crate::fs_ops::read_children(Path::new(path))
    }
    fn normalize(&self, path: &str) -> String {
        crate::fs_ops::normalize_path(path)
    }
    fn exists(&self, path: &str) -> bool {
        Path::new(path).exists()
    }
    fn watch_entry(&self, state: &WatchState, path: &str, entry_id: &str) -> Result<(), String> {
        state
            .0
            .lock()
            .unwrap()
            .watch_file(PathBuf::from(path), entry_id.to_string())
    }
    fn unwatch_entry(&self, state: &WatchState, path: &str) -> Result<(), String> {
        state.0.lock().unwrap().unwatch_file(PathBuf::from(path))
    }
    fn watch_folder(&self, state: &WatchState, path: &str, entry_id: &str) -> Result<(), String> {
        state
            .0
            .lock()
            .unwrap()
            .watch_folder(PathBuf::from(path), entry_id.to_string())
    }
    fn unwatch_folder(&self, state: &WatchState, path: &str) -> Result<(), String> {
        state.0.lock().unwrap().unwatch_folder(PathBuf::from(path))
    }
    fn clear_watches(&self, state: &WatchState) -> Result<(), String> {
        state.0.lock().unwrap().clear_all();
        Ok(())
    }
    fn sync_collection_watches(
        &self,
        state: &WatchState,
        collection_id: &str,
        specs: &[crate::fs_layer::watcher::WatchSpec],
    ) -> Result<crate::fs_layer::watcher::WatchCursor, String> {
        let mut manager = state.0.lock().unwrap();
        manager.sync_collection_specs(collection_id.to_string(), specs.to_vec())?;
        Ok(manager.current_cursor())
    }
    fn initialize_identity_cache(
        &self,
        cache: &FileIdentityCache,
        collection_id: &str,
    ) -> Result<(), String> {
        crate::fs_layer::file_identity::initialize_identity_cache_with_cache(
            &self.app,
            cache,
            collection_id,
        )
    }
    fn detect_moved_entry(
        &self,
        cache: &FileIdentityCache,
        collection_id: &str,
        entry_id: &str,
        old_path: &str,
    ) -> Result<Option<String>, String> {
        crate::fs_layer::file_identity::detect_moved_entry_with_cache(
            &self.app,
            cache,
            collection_id,
            entry_id,
            old_path,
        )
    }
}

pub fn assert_repository_send_sync<T: Send + Sync>() {}
