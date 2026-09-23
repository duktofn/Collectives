use crate::application::services::AppServices;
use crate::ipc::dto::ResolveCandidateDto;
use tauri::State;

#[tauri::command]
pub fn resolve_wikilink(
    state: State<'_, AppServices>,
    collection_id: String,
    note_name: String,
) -> Result<Option<ResolveCandidateDto>, String> {
    crate::application::services::resolve_wikilink(&state, collection_id, note_name)
        .map(|value| value.map(Into::into))
}
#[tauri::command]
pub fn search_link_index(
    state: State<'_, AppServices>,
    collection_id: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<ResolveCandidateDto>, String> {
    crate::application::services::search_link_index(&state, collection_id, query, limit)
        .map(|items| items.into_iter().map(Into::into).collect())
}
