use crate::collection::{self, Collection};
use crate::link_index;
use crate::settings::{self, Settings};
use chrono::Utc;
use tauri::AppHandle;
use uuid::Uuid;

#[tauri::command]
pub fn get_collections(app: AppHandle) -> Result<Vec<Collection>, String> {
    collection::get_all_collections(&app)
}

#[tauri::command]
pub fn create_collection(app: AppHandle, name: String) -> Result<Collection, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let collection = Collection {
        id,
        schema_version: 1,
        name,
        created_at: now.clone(),
        updated_at: now,
        entries: Vec::new(),
    };

    collection::save_collection(&app, &collection)?;
    Ok(collection)
}

#[tauri::command]
pub fn update_collection(app: AppHandle, mut collection: Collection) -> Result<(), String> {
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    collection.updated_at = now;

    collection::save_collection(&app, &collection)?;

    let conn = link_index::init_db(&app)?;
    link_index::update_index_for_collection(&conn, &collection)?;

    Ok(())
}

#[tauri::command]
pub fn delete_collection(app: AppHandle, id: String) -> Result<(), String> {
    collection::delete_collection(&app, &id)?;

    let conn = link_index::init_db(&app)?;
    link_index::clear_collection_entries(&conn, &id)?;

    Ok(())
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Settings {
    settings::load_settings(&app)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    settings::save_settings(&app, settings)
}

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}
