use std::fs;
use std::path::{Path, PathBuf};
use crate::settings::CustomFont;

pub fn get_fonts_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("fonts")
}

pub fn import_font(
    app_data_dir: &Path,
    source_path: &Path,
    family_name: &str,
    weight: &str,
    style: &str,
) -> Result<CustomFont, String> {
    if !source_path.exists() {
        return Err(format!("Source font file does not exist: {:?}", source_path));
    }

    let extension = source_path
        .extension()
        .and_then(|ext| ext.to_str())
        .ok_or_else(|| "Source file has no extension".to_string())?
        .to_lowercase();

    if extension != "ttf" && extension != "otf" && extension != "woff" && extension != "woff2" {
        return Err("Unsupported font extension. Allowed: .ttf, .otf, .woff, .woff2".to_string());
    }

    let fonts_dir = get_fonts_dir(app_data_dir);
    fs::create_dir_all(&fonts_dir).map_err(|e| format!("Failed to create fonts directory: {}", e))?;

    // Sanitize family name for safe file path
    let sanitized_family: String = family_name
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect();

    let file_name = format!("{}_{}_{}.{}", sanitized_family, weight, style, extension);
    let target_path = fonts_dir.join(&file_name);

    fs::copy(source_path, &target_path)
        .map_err(|e| format!("Failed to copy font file: {}", e))?;

    Ok(CustomFont {
        family: family_name.to_string(),
        file_name,
        weight: weight.to_string(),
        style: style.to_string(),
    })
}

pub fn delete_font(app_data_dir: &Path, file_name: &str) -> Result<(), String> {
    // Prevent directory traversal attacks by validating filename has no path separators
    if file_name.contains('/') || file_name.contains('\\') || file_name == ".." {
        return Err("Invalid file name".to_string());
    }
    
    let font_path = get_fonts_dir(app_data_dir).join(file_name);
    if font_path.exists() {
        fs::remove_file(font_path).map_err(|e| format!("Failed to remove font file: {}", e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_import_delete_font() {
        let temp_app_data = tempdir().unwrap();
        let temp_src_dir = tempdir().unwrap();
        
        let dummy_font_path = temp_src_dir.path().join("test_font.woff2");
        fs::write(&dummy_font_path, b"dummy font contents").unwrap();

        // 1. Successful import
        let imported = import_font(
            temp_app_data.path(),
            &dummy_font_path,
            "My Font",
            "400",
            "normal",
        ).unwrap();

        assert_eq!(imported.family, "My Font");
        assert_eq!(imported.file_name, "My_Font_400_normal.woff2");
        assert_eq!(imported.weight, "400");
        assert_eq!(imported.style, "normal");

        // Verify file copied
        let target_font_path = get_fonts_dir(temp_app_data.path()).join("My_Font_400_normal.woff2");
        assert!(target_font_path.exists());
        assert_eq!(fs::read_to_string(&target_font_path).unwrap(), "dummy font contents");

        // 2. Reject unsupported extension
        let invalid_font_path = temp_src_dir.path().join("test_font.txt");
        fs::write(&invalid_font_path, b"not a font").unwrap();
        let err = import_font(
            temp_app_data.path(),
            &invalid_font_path,
            "My Font",
            "400",
            "normal",
        );
        assert!(err.is_err());

        // 3. Delete font
        delete_font(temp_app_data.path(), "My_Font_400_normal.woff2").unwrap();
        assert!(!target_font_path.exists());

        // 4. Reject traversal on delete
        let traversal_err = delete_font(temp_app_data.path(), "../settings.json");
        assert!(traversal_err.is_err());
    }
}
