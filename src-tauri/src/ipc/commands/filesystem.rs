use crate::application::services::AppServices;
use crate::fs_layer::file_identity::FileIdentityCache;
use crate::fs_layer::watcher::WatchState;
use crate::ipc::dto::{FsEntryDto, WatchSpecDto};
use tauri::State;

#[tauri::command]
pub fn read_folder_children(
    state: State<'_, AppServices>,
    path: String,
) -> Result<Vec<FsEntryDto>, String> {
    crate::application::services::read_folder_children(&state, path)
        .map(|items| items.into_iter().map(Into::into).collect())
}
#[tauri::command]
pub fn watch_entry(
    services: State<'_, AppServices>,
    state: State<'_, WatchState>,
    path: String,
    entry_id: String,
) -> Result<(), String> {
    crate::application::services::watch_entry(&services, &state, path, entry_id)
}
#[tauri::command]
pub fn unwatch_entry(
    services: State<'_, AppServices>,
    state: State<'_, WatchState>,
    path: String,
) -> Result<(), String> {
    crate::application::services::unwatch_entry(&services, &state, path)
}
#[tauri::command]
pub fn watch_folder(
    services: State<'_, AppServices>,
    state: State<'_, WatchState>,
    path: String,
    entry_id: String,
) -> Result<(), String> {
    crate::application::services::watch_folder(&services, &state, path, entry_id)
}
#[tauri::command]
pub fn unwatch_folder(
    services: State<'_, AppServices>,
    state: State<'_, WatchState>,
    path: String,
) -> Result<(), String> {
    crate::application::services::unwatch_folder(&services, &state, path)
}
#[tauri::command]
pub fn clear_watches(
    services: State<'_, AppServices>,
    state: State<'_, WatchState>,
) -> Result<(), String> {
    crate::application::services::clear_watches(&services, &state)
}

#[tauri::command]
pub fn sync_collection_watches(
    state: State<'_, AppServices>,
    watch_state: State<'_, WatchState>,
    collection_id: String,
    specs: Vec<WatchSpecDto>,
) -> Result<crate::fs_layer::watcher::WatchCursor, String> {
    crate::application::services::sync_collection_watches(
        &state,
        &watch_state,
        collection_id,
        specs.into_iter().map(Into::into).collect(),
    )
}
#[tauri::command]
pub fn initialize_identity_cache(
    services: State<'_, AppServices>,
    cache_state: State<'_, FileIdentityCache>,
    collection_id: String,
) -> Result<(), String> {
    crate::application::services::initialize_identity_cache(&services, &cache_state, collection_id)
}
#[tauri::command]
pub fn detect_moved_entry(
    services: State<'_, AppServices>,
    cache_state: State<'_, FileIdentityCache>,
    collection_id: String,
    entry_id: String,
    old_path: String,
) -> Result<Option<String>, String> {
    crate::application::services::detect_moved_entry(
        &services,
        &cache_state,
        collection_id,
        entry_id,
        old_path,
    )
}
