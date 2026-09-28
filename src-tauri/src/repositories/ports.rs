use crate::collection::archive::ZipConflict;
use crate::collection::model::{Collection, Entry};
use crate::fs_layer::file_identity::FileIdentityCache;
use crate::fs_layer::watcher::WatchState;
use crate::fs_ops::FsEntry;
use crate::metadata::{MigrationStatus, MutationRequest, MutationResult};
use crate::repositories::documents::{DocumentSnapshot, DocumentWriteReceipt};
use crate::safety_error::SafetyError;
use crate::settings::{CustomFont, Settings};
use std::path::Path;

pub trait LinkRepository: Send + Sync {
    fn update_collection(&self, collection: &Collection) -> Result<(), String>;
    fn clear_collection(&self, collection_id: &str) -> Result<(), String>;
    fn resolve(
        &self,
        collection_id: &str,
        note_name: &str,
    ) -> Result<Option<crate::link_index::IndexEntry>, String>;
    fn search(
        &self,
        collection_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<crate::link_index::IndexEntry>, String>;
    fn path(&self) -> &Path;
}

pub trait CollectionRepository: Send + Sync {
    fn get_all(&self) -> Result<Vec<Collection>, String>;
    fn load(&self, id: &str) -> Result<Collection, String>;
    fn save(&self, collection: &Collection) -> Result<(), String>;
    fn delete(&self, id: &str) -> Result<(), String>;
    fn add_entry(
        &self,
        collection_id: &str,
        parent_path: &[usize],
        entry: Entry,
    ) -> Result<(), String>;
    fn remove_entry(&self, collection_id: &str, entry_id: &str) -> Result<Entry, String>;
    fn move_entry(
        &self,
        collection_id: &str,
        entry_id: &str,
        parent_path: &[usize],
        new_index: usize,
    ) -> Result<(), String>;
    fn delete_group_and_promote(&self, collection_id: &str, group_id: &str) -> Result<(), String>;
}

pub trait MetadataRepository: Send + Sync {
    fn apply_mutation(&self, request: MutationRequest) -> Result<MutationResult, SafetyError>;
    fn migration_status(&self) -> Result<MigrationStatus, SafetyError>;
    fn retry_migration(&self) -> Result<MigrationStatus, SafetyError>;
    fn snapshot(
        &self,
        collection_id: &str,
        cursor: crate::fs_layer::watcher::WatchCursor,
    ) -> Result<crate::metadata::MetadataSnapshot, SafetyError>;
}

pub trait ArchiveRepository: Send + Sync {
    fn import_folder(&self, path: &str, name: &str) -> Result<Collection, String>;
    fn export_folder(&self, collection_id: &str, destination: &str) -> Result<(), String>;
    fn export_zip(&self, collection_id: &str, destination: &str) -> Result<(), String>;
    fn check_zip_conflicts(
        &self,
        zip_path: &str,
        destination: &str,
    ) -> Result<Vec<ZipConflict>, String>;
    fn import_zip(
        &self,
        zip_path: &str,
        destination: &str,
        resolutions: std::collections::HashMap<String, String>,
    ) -> Result<Collection, String>;
}

pub trait DocumentRepository: Send + Sync {
    fn read(&self, path: &str) -> Result<DocumentSnapshot, SafetyError>;
    fn read_folderref_snapshot(
        &self,
        root_path: &str,
        child_path: &str,
    ) -> Result<DocumentSnapshot, SafetyError>;
    fn write(
        &self,
        path: &str,
        content: &str,
        expected_token: Option<String>,
    ) -> Result<DocumentWriteReceipt, SafetyError>;
}

pub trait SettingsRepository: Send + Sync {
    fn load(&self) -> Settings;
    fn save(&self, settings: Settings) -> Result<(), String>;
    fn import_font(
        &self,
        source: &str,
        family: &str,
        weight: &str,
        style: &str,
    ) -> Result<CustomFont, String>;
    fn delete_font(&self, file_name: &str) -> Result<(), String>;
    fn fonts_dir(&self) -> Result<String, String>;
    fn export_theme(&self, settings: &Settings, destination: &str) -> Result<(), String>;
    fn import_theme(&self, path: &str) -> Result<Settings, String>;
}

pub trait FilesystemRepository: Send + Sync {
    fn read_children(&self, path: &str) -> Result<Vec<FsEntry>, String>;
    fn normalize(&self, path: &str) -> String;
    fn exists(&self, path: &str) -> bool;
    fn watch_entry(&self, state: &WatchState, path: &str, entry_id: &str) -> Result<(), String>;
    fn unwatch_entry(&self, state: &WatchState, path: &str) -> Result<(), String>;
    fn watch_folder(&self, state: &WatchState, path: &str, entry_id: &str) -> Result<(), String>;
    fn unwatch_folder(&self, state: &WatchState, path: &str) -> Result<(), String>;
    fn clear_watches(&self, state: &WatchState) -> Result<(), String>;
    fn sync_collection_watches(
        &self,
        state: &WatchState,
        collection_id: &str,
        specs: &[crate::fs_layer::watcher::WatchSpec],
    ) -> Result<crate::fs_layer::watcher::WatchCursor, String>;
    fn initialize_identity_cache(
        &self,
        cache: &FileIdentityCache,
        collection_id: &str,
    ) -> Result<(), String>;
    fn detect_moved_entry(
        &self,
        cache: &FileIdentityCache,
        collection_id: &str,
        entry_id: &str,
        old_path: &str,
    ) -> Result<Option<String>, String>;
}
