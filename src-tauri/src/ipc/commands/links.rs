use crate::application::services::AppServices;
use crate::ipc::dto::ContentSearchPageDto;
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

#[tauri::command]
pub async fn search_note_content(
    state: State<'_, AppServices>,
    collection_id: String,
    query: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<ContentSearchPageDto, String> {
    let services = state.inner().clone();
    let page = tokio::task::spawn_blocking(move || {
        crate::application::services::search_note_content(
            &services,
            collection_id,
            query,
            offset.unwrap_or(0),
            limit.unwrap_or(20),
        )
    })
    .await
    .map_err(|error| format!("Content search worker failed: {error}"))??;
    Ok(page.into())
}
