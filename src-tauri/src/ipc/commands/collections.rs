use crate::application::services::AppServices;
use crate::ipc::dto::{
    BrokenEntryDto, CollectionDto, EntryDto, MetadataMutationRequestDto, MetadataMutationResultDto,
};
use tauri::State;

#[tauri::command]
pub fn get_collections(state: State<'_, AppServices>) -> Result<Vec<CollectionDto>, String> {
    crate::application::services::get_collections(&state)
        .map(|items| items.into_iter().map(Into::into).collect())
}
#[tauri::command]
pub fn create_collection(
    state: State<'_, AppServices>,
    name: String,
) -> Result<CollectionDto, String> {
    crate::application::services::create_collection(&state, name).map(Into::into)
}
#[tauri::command]
pub fn update_collection(
    state: State<'_, AppServices>,
    collection: CollectionDto,
) -> Result<(), String> {
    crate::application::services::update_collection(&state, collection.into())
}
#[tauri::command]
pub fn delete_collection(state: State<'_, AppServices>, id: String) -> Result<(), String> {
    crate::application::services::delete_collection(&state, id)
}
#[tauri::command]
pub fn add_entry(
    state: State<'_, AppServices>,
    collection_id: String,
    parent_path: Vec<usize>,
    entry: EntryDto,
) -> Result<(), String> {
    crate::application::services::add_entry(&state, collection_id, parent_path, entry.into())
}
#[tauri::command]
pub fn remove_entry(
    state: State<'_, AppServices>,
    collection_id: String,
    entry_id: String,
) -> Result<EntryDto, String> {
    crate::application::services::remove_entry(&state, collection_id, entry_id).map(Into::into)
}
#[tauri::command]
pub fn delete_group_and_promote(
    state: State<'_, AppServices>,
    collection_id: String,
    group_id: String,
) -> Result<(), String> {
    crate::application::services::delete_group_and_promote(&state, collection_id, group_id)
}
#[tauri::command]
pub fn move_entry(
    state: State<'_, AppServices>,
    collection_id: String,
    entry_id: String,
    new_parent_path: Vec<usize>,
    new_index: usize,
) -> Result<(), String> {
    crate::application::services::move_entry(
        &state,
        collection_id,
        entry_id,
        new_parent_path,
        new_index,
    )
}
#[tauri::command]
pub fn create_group(
    state: State<'_, AppServices>,
    collection_id: String,
    name: String,
    parent_path: Vec<usize>,
) -> Result<EntryDto, String> {
    crate::application::services::create_group(&state, collection_id, name, parent_path)
        .map(Into::into)
}
#[tauri::command]
pub fn rename_group(
    state: State<'_, AppServices>,
    collection_id: String,
    group_id: String,
    new_name: String,
) -> Result<(), String> {
    crate::application::services::rename_group(&state, collection_id, group_id, new_name)
}
#[tauri::command]
pub fn add_file_entries(
    state: State<'_, AppServices>,
    collection_id: String,
    paths: Vec<String>,
) -> Result<Vec<EntryDto>, String> {
    crate::application::services::add_file_entries(&state, collection_id, paths)
        .map(|items| items.into_iter().map(Into::into).collect())
}
#[tauri::command]
pub fn add_folder_ref(
    state: State<'_, AppServices>,
    collection_id: String,
    path: String,
) -> Result<EntryDto, String> {
    crate::application::services::add_folder_ref(&state, collection_id, path).map(Into::into)
}
#[tauri::command]
pub async fn validate_entries(
    state: State<'_, AppServices>,
    collection_id: String,
) -> Result<Vec<BrokenEntryDto>, String> {
    crate::application::services::validate_entries(&state, collection_id)
        .await
        .map(|items| items.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub fn apply_collection_mutation_v2(
    state: State<'_, AppServices>,
    request: MetadataMutationRequestDto,
) -> Result<MetadataMutationResultDto, crate::safety_error::SafetyError> {
    crate::application::services::apply_collection_mutation_v2(&state, request.into())
        .map(Into::into)
}
