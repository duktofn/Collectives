use crate::application::services::AppServices;
use crate::ipc::dto::FileSnapshotDto;
use crate::safety_error::SafetyError;
use tauri::State;

#[tauri::command]
pub fn read_file(
    state: State<'_, AppServices>,
    path: String,
) -> Result<FileSnapshotDto, SafetyError> {
    crate::application::services::read_file(&state, path).map(Into::into)
}

#[tauri::command]
pub fn read_folderref_snapshot(
    state: State<'_, AppServices>,
    root_path: String,
    child_path: String,
) -> Result<FileSnapshotDto, SafetyError> {
    crate::application::services::read_folderref_snapshot(&state, root_path, child_path)
        .map(Into::into)
}
#[tauri::command]
pub fn write_file(
    state: State<'_, AppServices>,
    path: String,
    content: String,
    expected_token: Option<String>,
) -> Result<crate::repositories::documents::DocumentWriteReceipt, SafetyError> {
    crate::application::services::write_file(&state, path, content, expected_token)
}
