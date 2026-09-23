use crate::application::services::AppServices;
use crate::fs_layer::watcher::WatchState;
use crate::ipc::dto::{MetadataSnapshotDto, WatchSpecDto};
use crate::metadata::MigrationStatus;
use tauri::State;

#[tauri::command]
pub fn migration_status(
    state: State<'_, AppServices>,
) -> Result<MigrationStatus, crate::safety_error::SafetyError> {
    crate::application::services::migration_status(&state)
}

#[tauri::command]
pub fn migration_retry(
    state: State<'_, AppServices>,
) -> Result<MigrationStatus, crate::safety_error::SafetyError> {
    crate::application::services::migration_retry(&state)
}

#[tauri::command]
pub fn reconcile_collection_snapshot(
    state: State<'_, AppServices>,
    watch_state: State<'_, WatchState>,
    collection_id: String,
    specs: Vec<WatchSpecDto>,
) -> Result<MetadataSnapshotDto, crate::safety_error::SafetyError> {
    crate::application::services::reconcile_collection_snapshot(
        &state,
        &watch_state,
        collection_id,
        specs.into_iter().map(Into::into).collect(),
    )
    .map(Into::into)
}
