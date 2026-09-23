use crate::application::services::AppServices;
use crate::ipc::dto::{CollectionDto, ZipConflictDto};
use crate::safety_error::SafetyError;
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub fn import_folder(
    state: State<'_, AppServices>,
    path: String,
    name: String,
) -> Result<CollectionDto, String> {
    crate::application::services::import_folder(&state, path, name).map(Into::into)
}
#[tauri::command]
pub fn export_collection_to_folder(
    state: State<'_, AppServices>,
    collection_id: String,
    dest_path: String,
) -> Result<(), SafetyError> {
    crate::application::services::export_collection_to_folder(&state, collection_id, dest_path)
}
#[tauri::command]
pub fn export_collection_to_zip(
    state: State<'_, AppServices>,
    collection_id: String,
    dest_zip_path: String,
) -> Result<(), SafetyError> {
    crate::application::services::export_collection_to_zip(&state, collection_id, dest_zip_path)
}
#[tauri::command]
pub fn check_zip_conflicts(
    state: State<'_, AppServices>,
    zip_path: String,
    dest_folder: String,
) -> Result<Vec<ZipConflictDto>, SafetyError> {
    crate::application::services::check_zip_conflicts(&state, zip_path, dest_folder)
        .map(|items| items.into_iter().map(Into::into).collect())
}
#[tauri::command]
pub fn import_zip(
    state: State<'_, AppServices>,
    zip_path: String,
    dest_folder: String,
    resolutions: HashMap<String, String>,
) -> Result<CollectionDto, SafetyError> {
    crate::application::services::import_zip(&state, zip_path, dest_folder, resolutions)
        .map(Into::into)
}
