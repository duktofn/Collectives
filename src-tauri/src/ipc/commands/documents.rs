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
    precondition: Option<crate::repositories::documents::WritePrecondition>,
) -> Result<crate::repositories::documents::DocumentWriteReceipt, SafetyError> {
    let precondition = require_precondition(precondition)?;
    crate::application::services::write_file(&state, path, content, precondition)
}

fn require_precondition(
    precondition: Option<crate::repositories::documents::WritePrecondition>,
) -> Result<crate::repositories::documents::WritePrecondition, SafetyError> {
    precondition.ok_or_else(|| {
        SafetyError::new("precondition_required", "A write precondition is required")
    })
}

#[tauri::command]
pub fn create_file(
    state: State<'_, AppServices>,
    path: String,
    content: String,
) -> Result<crate::repositories::documents::DocumentWriteReceipt, SafetyError> {
    crate::application::services::create_file(&state, path, content)
}

#[cfg(test)]
mod tests {
    #[test]
    fn omitted_precondition_is_rejected() {
        assert_eq!(
            super::require_precondition(None).unwrap_err().code,
            "precondition_required"
        );
    }
}
