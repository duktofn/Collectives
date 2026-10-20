use std::fs;
use tauri_app_lib::settings::{
    load_settings_checked_from_path, recover_settings_to_path, save_settings_to_path, CodeColors,
    CustomFont, CustomTheme, Settings, ThemeColors, ThemePalette,
};

fn custom_settings() -> Settings {
    Settings {
        theme: "light".into(),
        font_body: Some("Inter".into()),
        font_mono: Some("Fira Code".into()),
        font_scale: 1.15,
        custom_fonts: Some(vec![CustomFont {
            family: "Inter".into(),
            file_name: "inter-regular.ttf".into(),
            weight: "400".into(),
            style: "normal".into(),
        }]),
        custom_themes: Some(vec![CustomTheme {
            id: "custom-1".into(),
            name: "Breeze".into(),
            palette: ThemePalette {
                mode: "light".into(),
                accent: "#2766cc".into(),
                selection: "#dce8fa".into(),
                note: Default::default(),
                code: CodeColors {
                    r#type: Some("#2457a6".into()),
                    ..Default::default()
                },
                interface: ThemeColors {
                    background: Some("#f5f7fa".into()),
                    ..Default::default()
                },
            },
        }]),
        active_theme_id: Some("custom-1".into()),
        ..Default::default()
    }
}

#[test]
fn missing_settings_are_a_valid_first_launch_and_save_with_a_schema_marker() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");

    let initial = load_settings_checked_from_path(&path).unwrap();
    assert_eq!(initial, Settings::default());

    save_settings_to_path(&path, &initial).unwrap();
    let serialized: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(serialized["schemaVersion"], 1);
    assert_eq!(load_settings_checked_from_path(&path).unwrap(), initial);
}

#[test]
fn malformed_settings_are_reported_and_normal_save_preserves_the_original_bytes() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    let original = b"{\"theme\": ".to_vec();
    fs::write(&path, &original).unwrap();

    let load_error = load_settings_checked_from_path(&path).unwrap_err();
    assert!(
        load_error.starts_with("settings_invalid_file:"),
        "{load_error}"
    );
    assert!(save_settings_to_path(&path, &Settings::default()).is_err());
    assert_eq!(fs::read(&path).unwrap(), original);
}

#[test]
fn unsupported_future_schema_is_rejected_without_overwriting_the_file() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    let original =
        br#"{"schemaVersion":2,"theme":"future","fontScale":1.4,"newField":{"keep":true}}"#;
    fs::write(&path, original).unwrap();

    let load_error = load_settings_checked_from_path(&path).unwrap_err();
    assert!(
        load_error.starts_with("settings_future_version:"),
        "{load_error}"
    );
    assert!(save_settings_to_path(&path, &Settings::default()).is_err());
    assert_eq!(fs::read(&path).unwrap(), original);
}

#[test]
fn settings_path_read_errors_are_not_treated_as_first_launch() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    fs::create_dir(&path).unwrap();
    let marker = path.join("preserve.bin");
    let original = b"keep directory contents";
    fs::write(&marker, original).unwrap();

    let load_error = load_settings_checked_from_path(&path).unwrap_err();
    assert!(
        load_error.starts_with("settings_read_error:"),
        "{load_error}"
    );
    assert!(save_settings_to_path(&path, &Settings::default()).is_err());
    assert_eq!(fs::read(&marker).unwrap().as_slice(), original);
}

#[test]
fn legacy_and_current_settings_round_trip_custom_themes_and_fonts() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    let settings = custom_settings();

    fs::write(
        &path,
        r#"{"theme":"light","fontScale":1.0,"fontBody":"Legacy Font"}"#,
    )
    .unwrap();
    assert_eq!(
        load_settings_checked_from_path(&path)
            .unwrap()
            .font_body
            .as_deref(),
        Some("Legacy Font")
    );

    save_settings_to_path(&path, &settings).unwrap();
    assert_eq!(load_settings_checked_from_path(&path).unwrap(), settings);
}

#[test]
fn explicit_recovery_keeps_an_exact_backup_before_writing_defaults() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    let original = b"{ invalid settings from the previous release\n";
    fs::write(&path, original).unwrap();

    let backup = recover_settings_to_path(&path, &Settings::default())
        .unwrap()
        .expect("corrupt settings should be backed up");

    assert_eq!(fs::read(backup).unwrap().as_slice(), original);
    assert_eq!(
        load_settings_checked_from_path(&path).unwrap(),
        Settings::default()
    );
}

#[test]
fn recovery_does_not_reset_a_file_that_was_fixed_after_the_prompt_opened() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    fs::write(&path, r#"{"theme":"light","fontScale":1.25}"#).unwrap();
    let original = fs::read(&path).unwrap();

    let error = recover_settings_to_path(&path, &Settings::default()).unwrap_err();
    assert!(error.starts_with("settings_recovery_not_required:"));
    assert_eq!(fs::read(&path).unwrap(), original);
}

#[test]
fn explicit_recovery_can_initialize_defaults_if_the_corrupt_file_was_removed() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    fs::write(&path, "{broken").unwrap();
    fs::remove_file(&path).unwrap();

    let backup = recover_settings_to_path(&path, &Settings::default()).unwrap();

    assert_eq!(backup, None);
    assert_eq!(
        load_settings_checked_from_path(&path).unwrap(),
        Settings::default()
    );
}

#[cfg(windows)]
#[test]
fn failed_recovery_while_the_file_is_locked_preserves_its_original_bytes() {
    use std::os::windows::fs::OpenOptionsExt;

    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    let original = b"{corrupt but retained}";
    fs::write(&path, original).unwrap();
    let lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&path)
        .unwrap();

    let error = recover_settings_to_path(&path, &Settings::default()).unwrap_err();
    assert!(error.starts_with("settings_recovery_preserve_failed:"));
    drop(lock);
    assert_eq!(fs::read(&path).unwrap().as_slice(), original);
}
