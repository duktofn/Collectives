use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};
use base64::{prelude::BASE64_STANDARD, Engine};
use crate::settings::{Settings, CustomFont};
use crate::font_manager::get_fonts_dir;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportedFont {
    family: String,
    file_name: String,
    weight: String,
    style: String,
    base64_data: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportedTheme {
    settings: Settings,
    fonts: Vec<ExportedFont>,
}

pub fn export_theme(
    app_data_dir: &Path,
    settings: &Settings,
    dest_path: &Path,
) -> Result<(), String> {
    let mut fonts = Vec::new();
    
    if let Some(custom_fonts) = &settings.custom_fonts {
        let fonts_dir = get_fonts_dir(app_data_dir);
        for font in custom_fonts {
            let font_path = fonts_dir.join(&font.file_name);
            if font_path.exists() {
                let bytes = fs::read(&font_path)
                    .map_err(|e| format!("Failed to read font file {:?}: {}", font_path, e))?;
                let base64_data = BASE64_STANDARD.encode(&bytes);
                fonts.push(ExportedFont {
                    family: font.family.clone(),
                    file_name: font.file_name.clone(),
                    weight: font.weight.clone(),
                    style: font.style.clone(),
                    base64_data,
                });
            }
        }
    }

    let theme = ExportedTheme {
        settings: settings.clone(),
        fonts,
    };

    let data = serde_json::to_string_pretty(&theme)
        .map_err(|e| format!("Failed to serialize theme: {}", e))?;

    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    
    fs::write(dest_path, data)
        .map_err(|e| format!("Failed to write theme file: {}", e))?;

    Ok(())
}

pub fn import_theme(
    app_data_dir: &Path,
    theme_path: &Path,
) -> Result<Settings, String> {
    if !theme_path.exists() {
        return Err(format!("Theme file does not exist: {:?}", theme_path));
    }

    let data = fs::read_to_string(theme_path)
        .map_err(|e| format!("Failed to read theme file: {}", e))?;

    let theme: ExportedTheme = serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse theme file: {}", e))?;

    let fonts_dir = get_fonts_dir(app_data_dir);
    fs::create_dir_all(&fonts_dir)
        .map_err(|e| format!("Failed to create fonts directory: {}", e))?;

    // Restore font files
    for font in &theme.fonts {
        // Directory traversal check
        if font.file_name.contains('/') || font.file_name.contains('\\') || font.file_name == ".." {
            return Err(format!("Invalid font file name in theme: {}", font.file_name));
        }

        let bytes = BASE64_STANDARD.decode(&font.base64_data)
            .map_err(|e| format!("Failed to decode base64 font data: {}", e))?;

        let font_dest_path = fonts_dir.join(&font.file_name);
        fs::write(&font_dest_path, bytes)
            .map_err(|e| format!("Failed to write font file {:?}: {}", font_dest_path, e))?;
    }

    Ok(theme.settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_theme_export_import_roundtrip() {
        let temp_app_data = tempdir().unwrap();
        let temp_dest = tempdir().unwrap();
        
        let fonts_dir = get_fonts_dir(temp_app_data.path());
        fs::create_dir_all(&fonts_dir).unwrap();

        // Create dummy font
        let font_file_name = "TestFont_400_normal.woff2";
        fs::write(fonts_dir.join(font_file_name), b"mock woff2 data").unwrap();

        let settings = Settings {
            theme: "dark".to_string(),
            font_body: Some("TestFont".to_string()),
            font_mono: None,
            font_scale: 1.1,
            size_h1: Some(3.0),
            color_h1: Some("#ffffff".to_string()),
            custom_fonts: Some(vec![CustomFont {
                family: "TestFont".to_string(),
                file_name: font_file_name.to_string(),
                weight: "400".to_string(),
                style: "normal".to_string(),
            }]),
            ..Default::default()
        };

        let export_path = temp_dest.path().join("my_theme.json");
        
        // 1. Export theme
        export_theme(temp_app_data.path(), &settings, &export_path).unwrap();
        assert!(export_path.exists());

        // 2. Import into a new empty app data dir
        let temp_app_data_new = tempdir().unwrap();
        let imported_settings = import_theme(temp_app_data_new.path(), &export_path).unwrap();

        // Verify settings recovered
        assert_eq!(imported_settings.theme, "dark");
        assert_eq!(imported_settings.font_body.unwrap(), "TestFont");
        assert_eq!(imported_settings.font_scale, 1.1);
        assert_eq!(imported_settings.size_h1.unwrap(), 3.0);
        assert_eq!(imported_settings.color_h1.unwrap(), "#ffffff");
        
        let custom_fonts = imported_settings.custom_fonts.unwrap();
        assert_eq!(custom_fonts.len(), 1);
        assert_eq!(custom_fonts[0].family, "TestFont");

        // Verify font file restored
        let restored_font_path = get_fonts_dir(temp_app_data_new.path()).join(font_file_name);
        assert!(restored_font_path.exists());
        assert_eq!(fs::read(&restored_font_path).unwrap(), b"mock woff2 data");
    }
}
