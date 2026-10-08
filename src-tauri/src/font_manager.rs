use crate::settings::CustomFont;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use std::fs;
use std::path::{Path, PathBuf};

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
        return Err(format!(
            "Source font file does not exist: {:?}",
            source_path
        ));
    }

    let extension = source_path
        .extension()
        .and_then(|ext| ext.to_str())
        .ok_or_else(|| "Source file has no extension".to_string())?
        .to_lowercase();

    if extension != "ttf" && extension != "otf" && extension != "woff" && extension != "woff2" {
        return Err("Unsupported font extension. Allowed: .ttf, .otf, .woff, .woff2".to_string());
    }

    // Sanitize family name for safe file path
    let sanitized_family: String = family_name
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect();

    let preferred_name = format!("{}_{}_{}.{}", sanitized_family, weight, style, extension);
    let bytes = fs::read(source_path).map_err(|e| format!("Failed to read font file: {}", e))?;
    install_font_bytes(
        app_data_dir,
        &preferred_name,
        family_name,
        weight,
        style,
        &bytes,
    )
}

pub fn import_font_base64(
    app_data_dir: &Path,
    preferred_name: &str,
    family_name: &str,
    weight: &str,
    style: &str,
    data_base64: &str,
) -> Result<CustomFont, String> {
    let bytes = BASE64_STANDARD
        .decode(data_base64)
        .map_err(|e| format!("Failed to decode font data: {}", e))?;
    install_font_bytes(
        app_data_dir,
        preferred_name,
        family_name,
        weight,
        style,
        &bytes,
    )
}

fn install_font_bytes(
    app_data_dir: &Path,
    preferred_name: &str,
    family_name: &str,
    weight: &str,
    style: &str,
    bytes: &[u8],
) -> Result<CustomFont, String> {
    if preferred_name.contains('/') || preferred_name.contains('\\') || preferred_name == ".." {
        return Err("Invalid font file name".to_string());
    }
    let extension = Path::new(preferred_name)
        .extension()
        .and_then(|ext| ext.to_str())
        .ok_or_else(|| "Source file has no extension".to_string())?
        .to_lowercase();
    if extension != "ttf" && extension != "otf" && extension != "woff" && extension != "woff2" {
        return Err("Unsupported font extension. Allowed: .ttf, .otf, .woff, .woff2".to_string());
    }
    let fonts_dir = get_fonts_dir(app_data_dir);
    fs::create_dir_all(&fonts_dir)
        .map_err(|e| format!("Failed to create fonts directory: {}", e))?;
    let stem = Path::new(preferred_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Invalid font file name".to_string())?;
    let mut file_name = preferred_name.to_string();
    let mut suffix = 2;
    loop {
        let target_path = fonts_dir.join(&file_name);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target_path)
        {
            Ok(mut file) => {
                use std::io::Write;
                if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
                    let _ = fs::remove_file(&target_path);
                    return Err(format!("Failed to write font file: {}", error));
                }
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                file_name = format!("{}_{}.{}", stem, suffix, extension);
                suffix += 1;
            }
            Err(error) => return Err(format!("Failed to create font file: {}", error)),
        }
    }

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
        )
        .unwrap();

        assert_eq!(imported.family, "My Font");
        assert_eq!(imported.file_name, "My_Font_400_normal.woff2");
        assert_eq!(imported.weight, "400");
        assert_eq!(imported.style, "normal");

        // Verify file copied
        let target_font_path = get_fonts_dir(temp_app_data.path()).join("My_Font_400_normal.woff2");
        assert!(target_font_path.exists());
        assert_eq!(
            fs::read_to_string(&target_font_path).unwrap(),
            "dummy font contents"
        );

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

    #[test]
    fn test_imported_font_name_collision_never_overwrites_existing_font() {
        let temp_app_data = tempdir().unwrap();
        let first = import_font_base64(
            temp_app_data.path(),
            "ThemeFont.woff2",
            "Theme Font",
            "400",
            "normal",
            &BASE64_STANDARD.encode(b"first font"),
        )
        .unwrap();
        let second = import_font_base64(
            temp_app_data.path(),
            "ThemeFont.woff2",
            "Theme Font",
            "400",
            "normal",
            &BASE64_STANDARD.encode(b"second font"),
        )
        .unwrap();

        assert_eq!(first.file_name, "ThemeFont.woff2");
        assert_eq!(second.file_name, "ThemeFont_2.woff2");
        assert_eq!(
            fs::read(get_fonts_dir(temp_app_data.path()).join(&first.file_name)).unwrap(),
            b"first font"
        );
        assert_eq!(
            fs::read(get_fonts_dir(temp_app_data.path()).join(&second.file_name)).unwrap(),
            b"second font"
        );
    }
}
