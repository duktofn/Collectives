use crate::application::services::AppServices;
use crate::ipc::dto::{CustomFontDto, SettingsDto};
use tauri::State;

#[tauri::command]
pub fn load_settings(state: State<'_, AppServices>) -> SettingsDto {
    crate::application::services::load_settings(&state).into()
}
#[tauri::command]
pub fn save_settings(state: State<'_, AppServices>, settings: SettingsDto) -> Result<(), String> {
    crate::application::services::save_settings(&state, settings.into())
}
#[tauri::command]
pub fn import_font(
    state: State<'_, AppServices>,
    source_path: String,
    family_name: String,
    weight: String,
    style: String,
) -> Result<CustomFontDto, String> {
    crate::application::services::import_font(&state, source_path, family_name, weight, style)
        .map(Into::into)
}
#[tauri::command]
pub fn delete_font(state: State<'_, AppServices>, file_name: String) -> Result<(), String> {
    crate::application::services::delete_font(&state, file_name)
}
#[tauri::command]
pub fn get_fonts_dir(state: State<'_, AppServices>) -> Result<String, String> {
    crate::application::services::get_fonts_dir(&state)
}
#[tauri::command]
pub fn export_theme(
    state: State<'_, AppServices>,
    settings: SettingsDto,
    dest_path: String,
) -> Result<(), String> {
    crate::application::services::export_theme(&state, settings.into(), dest_path)
}
#[tauri::command]
pub fn import_theme(
    state: State<'_, AppServices>,
    theme_path: String,
) -> Result<SettingsDto, String> {
    crate::application::services::import_theme(&state, theme_path).map(Into::into)
}
