use crate::application::services::AppServices;
use crate::ipc::dto::{CustomFontDto, SettingsDto};
use tauri::State;

#[tauri::command]
pub fn load_settings(state: State<'_, AppServices>) -> Result<SettingsDto, String> {
    let app = state
        .app
        .as_ref()
        .ok_or_else(|| "Settings storage is unavailable".to_string())?;
    crate::settings::load_settings_checked(app).map(Into::into)
}
#[tauri::command]
pub fn save_settings(
    state: State<'_, AppServices>,
    settings: SettingsDto,
    recovery_confirmed: Option<bool>,
) -> Result<Option<String>, String> {
    let settings = settings.into();
    if recovery_confirmed.unwrap_or(false) {
        let app = state.app.as_ref().ok_or_else(|| {
            "Settings recovery requires the application settings file".to_string()
        })?;
        crate::settings::recover_settings(app, settings)
    } else {
        crate::application::services::save_settings(&state, settings).map(|_| None)
    }
}
#[tauri::command]
pub fn import_font(
    state: State<'_, AppServices>,
    source_path: String,
    family_name: String,
    weight: String,
    style: String,
    font_data_base64: Option<String>,
    preferred_file_name: Option<String>,
) -> Result<CustomFontDto, String> {
    if let Some(data_base64) = font_data_base64 {
        let file_name = preferred_file_name.ok_or_else(|| "Missing font file name".to_string())?;
        crate::application::services::import_font_base64(
            &state,
            file_name,
            family_name,
            weight,
            style,
            data_base64,
        )
        .map(Into::into)
    } else {
        crate::application::services::import_font(&state, source_path, family_name, weight, style)
            .map(Into::into)
    }
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
) -> Result<crate::theme_io::ImportedTheme, String> {
    crate::application::services::import_theme(&state, theme_path)
}
