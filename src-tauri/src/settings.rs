use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct ThemePalette {
    pub mode: String,
    pub accent: String,
    pub selection: String,
    pub note: std::collections::BTreeMap<String, String>,
    pub code: CodeColors,
    pub interface: ThemeColors,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CustomTheme {
    pub id: String,
    pub name: String,
    pub palette: ThemePalette,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct CodeColors {
    pub text: Option<String>,
    pub background: Option<String>,
    pub keyword: Option<String>,
    pub modifier: Option<String>,
    pub r#type: Option<String>,
    pub function: Option<String>,
    pub variable: Option<String>,
    pub property: Option<String>,
    pub string: Option<String>,
    pub number: Option<String>,
    pub comment: Option<String>,
    pub annotation: Option<String>,
    pub r#macro: Option<String>,
    pub line_number: Option<String>,
    pub active_line_number: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct ThemeColors {
    pub background: Option<String>,
    pub surface: Option<String>,
    pub border: Option<String>,
    pub text: Option<String>,
    pub secondary_text: Option<String>,
    pub hover: Option<String>,
    pub active: Option<String>,
}

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
    #[serde(default)]
    pub sidebar_hover_reveal: Option<bool>,
    #[serde(default)]
    pub note_layout: Option<String>,
    #[serde(default)]
    pub note_width: Option<f32>,
    #[serde(default)]
    pub highlight_code_occurrences: Option<bool>,
    #[serde(default)]
    pub highlight_markdown_occurrences: Option<bool>,
    #[serde(default)]
    pub custom_themes: Option<Vec<CustomTheme>>,
    #[serde(default)]
    pub active_theme_id: Option<String>,
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
    #[serde(alias = "color_body")]
    pub color_body: Option<String>,
    #[serde(default)]
    pub color_accent: Option<String>,
    #[serde(default)]
    pub code_colors: Option<CodeColors>,
    #[serde(default)]
    pub theme_colors: Option<ThemeColors>,
    pub color_h2: Option<String>,
    pub color_h3: Option<String>,
    pub color_h4: Option<String>,

    // Custom elements colors
    pub color_code_bg: Option<String>,
    pub color_code_text: Option<String>,
    pub color_selection: Option<String>,
    pub color_link: Option<String>,
    pub color_link_hover: Option<String>,

    // Line spacing
    pub line_height: Option<f32>,

    // Imported custom fonts registry
    pub custom_fonts: Option<Vec<CustomFont>>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            sidebar_hover_reveal: None,
            note_layout: None,
            note_width: None,
            highlight_code_occurrences: None,
            highlight_markdown_occurrences: None,
            custom_themes: None,
            active_theme_id: None,
            theme: "dark".to_string(),
            font_body: None,
            font_mono: None,
            font_scale: 1.0,
            size_h1: None,
            size_h2: None,
            size_h3: None,
            size_h4: None,
            color_h1: None,
            color_body: None,
            color_accent: None,
            code_colors: None,
            theme_colors: None,
            color_h2: None,
            color_h3: None,
            color_h4: None,
            color_code_bg: None,
            color_code_text: None,
            color_selection: None,
            color_link: None,
            color_link_hover: None,
            line_height: None,
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
    let parent = settings_file.parent().unwrap_or_else(|| Path::new("."));
    let temp_file = parent.join(format!(".settings-{}.tmp", uuid::Uuid::new_v4()));
    let write_result: Result<(), String> = (|| {
        use std::io::Write;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_file)
            .map_err(|e| format!("Failed to create temporary settings file: {}", e))?;
        file.write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write temporary settings file: {}", e))?;
        file.sync_all()
            .map_err(|e| format!("Failed to flush temporary settings file: {}", e))?;
        fs::rename(&temp_file, settings_file)
            .map_err(|e| format!("Failed to replace settings file: {}", e))?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temp_file);
    }
    write_result?;
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

    #[test]
    fn test_settings_save_replaces_existing_file_and_cleans_temporary_file() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("settings.json");
        fs::write(&file_path, "previous settings").unwrap();

        let settings = Settings {
            theme: "light".to_string(),
            font_scale: 1.25,
            ..Default::default()
        };
        save_settings_to_path(&file_path, &settings).unwrap();

        let loaded = load_settings_from_path(&file_path);
        assert_eq!(loaded.theme, "light");
        assert_eq!(loaded.font_scale, 1.25);
        assert!(!temp_dir.path().read_dir().unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".settings-")
        }));
    }

    #[test]
    fn legacy_settings_load_without_optional_preferences() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("settings.json");
        fs::write(&file_path, r#"{"theme":"light","fontScale":1.2}"#).unwrap();

        let loaded = load_settings_from_path(&file_path);

        assert_eq!(loaded.theme, "light");
    }

    #[test]
    fn independent_palettes_survive_ipc_and_settings_storage() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let settings = Settings {
            sidebar_hover_reveal: Some(false),
            highlight_code_occurrences: Some(false),
            highlight_markdown_occurrences: Some(true),
            note_layout: Some("centered".into()),
            note_width: Some(640.0),
            active_theme_id: Some("custom-1".into()),
            custom_themes: Some(vec![CustomTheme {
                id: "custom-1".into(),
                name: "Breeze".into(),
                palette: ThemePalette {
                    mode: "dark".into(),
                    accent: "#aabbcc".into(),
                    ..Default::default()
                },
            }]),
            color_h1: Some("#ff6688".into()),
            code_colors: Some(CodeColors {
                r#type: Some("#55bbff".into()),
                r#macro: Some("#76c7ba".into()),
                active_line_number: Some("#ffffff".into()),
                ..Default::default()
            }),
            theme_colors: Some(ThemeColors {
                background: Some("#101820".into()),
                surface: Some("#182832".into()),
                border: Some("#405060".into()),
                ..Default::default()
            }),
            ..Default::default()
        };
        let dto: crate::ipc::dto::SettingsDto = settings.clone().into();
        let wire = serde_json::to_value(dto).unwrap();
        assert_eq!(wire["customThemes"][0]["palette"]["accent"], "#aabbcc");
        assert_eq!(wire["sidebarHoverReveal"], false);
        assert_eq!(wire["highlightMarkdownOccurrences"], true);
        assert_eq!(wire["noteWidth"], 640.0);
        assert_eq!(wire["codeColors"]["type"], "#55bbff");
        assert_eq!(wire["codeColors"]["macro"], "#76c7ba");
        assert_eq!(wire["codeColors"]["activeLineNumber"], "#ffffff");
        let dto: crate::ipc::dto::SettingsDto = serde_json::from_value(wire).unwrap();
        let restored: Settings = dto.into();
        assert_eq!(restored, settings);
        save_settings_to_path(&path, &restored).unwrap();
        assert_eq!(load_settings_from_path(&path), settings);
    }
}
