use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
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

const SETTINGS_SCHEMA_VERSION: u64 = 1;

pub fn load_settings_checked_from_path(settings_file: &Path) -> Result<Settings, String> {
    let data = match fs::read(settings_file) {
        Ok(data) => data,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Settings::default());
        }
        Err(error) => {
            return Err(format!(
                "settings_read_error: could not read {}: {error}",
                settings_file.display()
            ));
        }
    };

    let value: serde_json::Value = serde_json::from_slice(&data).map_err(|error| {
        format!(
            "settings_invalid_file: {} is not valid settings JSON: {error}",
            settings_file.display()
        )
    })?;

    let schema_version = match value.get("schemaVersion") {
        None => SETTINGS_SCHEMA_VERSION,
        Some(version) => version.as_u64().ok_or_else(|| {
            format!(
                "settings_invalid_file: {} has an invalid schemaVersion",
                settings_file.display()
            )
        })?,
    };
    if schema_version == 0 {
        return Err(format!(
            "settings_invalid_file: {} has an invalid schemaVersion",
            settings_file.display()
        ));
    }
    if schema_version > SETTINGS_SCHEMA_VERSION {
        return Err(format!(
            "settings_future_version: {} uses settings schema version {schema_version}; this app supports version {SETTINGS_SCHEMA_VERSION}",
            settings_file.display()
        ));
    }

    serde_json::from_value(value).map_err(|error| {
        format!(
            "settings_invalid_file: {} does not match a supported settings format: {error}",
            settings_file.display()
        )
    })
}

// Kept for legacy repository consumers; all IPC loads use the checked result above.
pub fn load_settings_from_path(settings_file: &Path) -> Settings {
    load_settings_checked_from_path(settings_file).unwrap_or_default()
}

pub fn save_settings_to_path(settings_file: &Path, settings: &Settings) -> Result<(), String> {
    load_settings_checked_from_path(settings_file).map_err(|error| {
        format!("{error}. Choose explicit settings recovery before saving defaults.")
    })?;
    save_settings_unchecked(settings_file, settings)
}

fn save_settings_unchecked(settings_file: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(parent) = settings_file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut value =
        serde_json::to_value(settings).map_err(|e| format!("Failed to serialize settings: {e}"))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "Failed to serialize settings as an object".to_string())?;
    object.insert(
        "schemaVersion".to_string(),
        serde_json::Value::from(SETTINGS_SCHEMA_VERSION),
    );
    let data = serde_json::to_vec_pretty(&value)
        .map_err(|e| format!("Failed to serialize settings: {e}"))?;
    let parent = settings_file.parent().unwrap_or_else(|| Path::new("."));
    let temp_file = parent.join(format!(".settings-{}.tmp", uuid::Uuid::new_v4()));
    let write_result: Result<(), String> = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_file)
            .map_err(|e| format!("Failed to create temporary settings file: {}", e))?;
        file.write_all(&data)
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

pub fn recover_settings_to_path(
    settings_file: &Path,
    settings: &Settings,
) -> Result<Option<String>, String> {
    if load_settings_checked_from_path(settings_file).is_ok() {
        match fs::symlink_metadata(settings_file) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                save_settings_unchecked(settings_file, settings)?;
                return Ok(None);
            }
            Err(error) => {
                return Err(format!(
                    "settings_recovery_not_required: could not confirm the settings file state: {error}"
                ));
            }
            Ok(_) => {
                return Err(
                    "settings_recovery_not_required: the settings file has become readable; reload before changing it".to_string(),
                );
            }
        }
    }

    let original = fs::read(settings_file).map_err(|error| {
        format!(
            "settings_recovery_preserve_failed: could not preserve the original bytes at {}: {error}",
            settings_file.display()
        )
    })?;
    let backup_path = settings_backup_path(settings_file);
    write_settings_backup(&backup_path, &original)?;

    if let Err(error) = save_settings_unchecked(settings_file, settings) {
        return Err(format!(
            "Settings recovery failed. The original file remains unchanged and a copy is preserved at {}: {error}",
            backup_path.display()
        ));
    }

    Ok(Some(backup_path.to_string_lossy().into_owned()))
}

fn settings_backup_path(settings_file: &Path) -> PathBuf {
    let parent = settings_file.parent().unwrap_or_else(|| Path::new("."));
    let name = settings_file
        .file_name()
        .unwrap_or_else(|| std::ffi::OsStr::new("settings.json"))
        .to_string_lossy();
    parent.join(format!("{name}.corrupt-{}.bak", uuid::Uuid::new_v4()))
}

fn write_settings_backup(backup_path: &Path, original: &[u8]) -> Result<(), String> {
    let mut created_by_this_call = false;
    let write_result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(backup_path)
            .map_err(|error| error.to_string())?;
        created_by_this_call = true;
        file.write_all(original)
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())
    })();

    if let Err(error) = write_result {
        if created_by_this_call {
            let _ = fs::remove_file(backup_path);
        }
        return Err(format!(
            "settings_recovery_preserve_failed: could not write a backup at {}: {error}",
            backup_path.display()
        ));
    }
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

pub fn load_settings_checked(app: &AppHandle) -> Result<Settings, String> {
    let path = get_settings_file_path(app)
        .map_err(|error| format!("settings_storage_unavailable: {error}"))?;
    load_settings_checked_from_path(&path)
}

pub fn save_settings(app: &AppHandle, settings: Settings) -> Result<(), String> {
    let path = get_settings_file_path(app)?;
    save_settings_to_path(&path, &settings)
}

pub fn recover_settings(app: &AppHandle, settings: Settings) -> Result<Option<String>, String> {
    let path = get_settings_file_path(app)
        .map_err(|error| format!("settings_storage_unavailable: {error}"))?;
    recover_settings_to_path(&path, &settings)
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
        fs::write(&file_path, r#"{"theme":"dark","fontScale":1.0}"#).unwrap();

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
