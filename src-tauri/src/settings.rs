use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CustomFont {
    pub family: String,
    pub file_name: String,
    pub weight: String, // e.g. "400", "700"
    pub style: String,  // e.g. "normal", "italic"
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub font_body: Option<String>,
    pub font_mono: Option<String>,
    pub font_scale: f32,
    
    // Heading sizes (multipliers or absolute values, Option allows defaulting)
    pub size_h1: Option<f32>,
    pub size_h2: Option<f32>,
    pub size_h3: Option<f32>,
    pub size_h4: Option<f32>,
    
    // Heading colors
    pub color_h1: Option<String>,
    pub color_h2: Option<String>,
    pub color_h3: Option<String>,
    pub color_h4: Option<String>,
    
    // Custom elements colors
    pub color_code_bg: Option<String>,
    pub color_code_text: Option<String>,
    pub color_link: Option<String>,
    pub color_link_hover: Option<String>,
    
    // Imported custom fonts registry
    pub custom_fonts: Option<Vec<CustomFont>>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            font_body: None,
            font_mono: None,
            font_scale: 1.0,
            size_h1: None,
            size_h2: None,
            size_h3: None,
            size_h4: None,
            color_h1: None,
            color_h2: None,
            color_h3: None,
            color_h4: None,
            color_code_bg: None,
            color_code_text: None,
            color_link: None,
            color_link_hover: None,
            custom_fonts: None,
        }
    }
}

pub fn load_settings_from_path(settings_file: &Path) -> Settings {
    if !settings_file.exists() {
        return Settings::default();
    }
    match fs::read_to_string(settings_file) {
        Ok(data) => serde_json::from_str(&data).unwrap_or_else(|_| Settings::default()),
        Err(_) => Settings::default(),
    }
}

pub fn save_settings_to_path(settings_file: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(parent) = settings_file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    fs::write(settings_file, data)
        .map_err(|e| format!("Failed to write settings file: {}", e))?;
    Ok(())
}

// Tauri wrappers
pub fn get_settings_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    Ok(app_data.join("settings.json"))
}

pub fn load_settings(app: &AppHandle) -> Settings {
    match get_settings_file_path(app) {
        Ok(path) => load_settings_from_path(&path),
        Err(_) => Settings::default(),
    }
}

pub fn save_settings(app: &AppHandle, settings: Settings) -> Result<(), String> {
    let path = get_settings_file_path(app)?;
    save_settings_to_path(&path, &settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_settings_load_save() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("settings.json");

        // Load non-existent -> returns default
        let initial = load_settings_from_path(&file_path);
        assert_eq!(initial.theme, "dark");
        assert_eq!(initial.font_scale, 1.0);

        // Save new settings
        let custom = Settings {
            theme: "dark".to_string(),
            font_body: Some("Inter".to_string()),
            font_mono: Some("Fira Code".to_string()),
            font_scale: 1.2,
            ..Default::default()
        };
        save_settings_to_path(&file_path, &custom).unwrap();

        // Load -> verify saved values
        let loaded = load_settings_from_path(&file_path);
        assert_eq!(loaded.theme, "dark");
        assert_eq!(loaded.font_body.unwrap(), "Inter");
        assert_eq!(loaded.font_mono.unwrap(), "Fira Code");
        assert_eq!(loaded.font_scale, 1.2);
    }
}

