use crate::application::services::AppServices;
use crate::ipc::dto::{ContentSearchPageDto, NoteLinkCandidateDto, ResolveCandidateDto};
use tauri::State;

#[tauri::command]
pub async fn resolve_wikilink(
    state: State<'_, AppServices>,
    collection_id: String,
    note_name: String,
    source_path: Option<String>,
) -> Result<Vec<NoteLinkCandidateDto>, String> {
    let services = state.inner().clone();
    let candidates = tokio::task::spawn_blocking(move || {
        crate::application::services::resolve_wikilink(
            &services,
            collection_id,
            note_name,
            source_path,
        )
    })
    .await
    .map_err(|error| format!("Wikilink resolution worker failed: {error}"))??;
    Ok(candidates.into_iter().map(Into::into).collect())
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
