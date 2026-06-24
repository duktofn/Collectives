use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::path::PathBuf;
use notify::{Watcher, RecommendedWatcher, recommended_watcher, RecursiveMode, EventKind, event::{ModifyKind, RenameMode}};
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEventPayload {
    pub entry_id: String,
    pub path: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameEventPayload {
    pub entry_id: String,
    pub old_path: String,
    pub new_path: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEventPayload {
    pub entry_id: String,
    pub path: String,
    pub changed_file_path: String,
}

pub struct WatchManager {
    watcher: Option<RecommendedWatcher>,
    watched_files: Arc<Mutex<HashMap<PathBuf, String>>>,
    watched_folders: Arc<Mutex<HashMap<PathBuf, String>>>,
    app_handle: Option<AppHandle>,
}

pub struct WatchState(pub Arc<Mutex<WatchManager>>);

impl WatchManager {
    pub fn new() -> Self {
        Self {
            watcher: None,
            watched_files: Arc::new(Mutex::new(HashMap::new())),
            watched_folders: Arc::new(Mutex::new(HashMap::new())),
            app_handle: None,
        }
    }

    pub fn init(&mut self, app: AppHandle) -> Result<(), String> {
        self.app_handle = Some(app.clone());
        let watched_files = Arc::clone(&self.watched_files);
        let watched_folders = Arc::clone(&self.watched_folders);

        let watcher = recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                let files = watched_files.lock().unwrap();
                let folders = watched_folders.lock().unwrap();

                for path in &event.paths {
                    // Check if directly watched as a file
                    if let Some(entry_id) = files.get(path) {
                        match event.kind {
                            EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
                                if event.paths.len() >= 2 {
                                    let old_path = &event.paths[0];
                                    let new_path = &event.paths[1];
                                    let _ = app.emit("entry-renamed", RenameEventPayload {
                                        entry_id: entry_id.clone(),
                                        old_path: old_path.to_string_lossy().to_string().replace('\\', "/"),
                                        new_path: new_path.to_string_lossy().to_string().replace('\\', "/"),
                                    });
                                }
                            }
                            EventKind::Modify(_) => {
                                let _ = app.emit("file-modified", FileEventPayload {
                                    entry_id: entry_id.clone(),
                                    path: path.to_string_lossy().to_string().replace('\\', "/"),
                                });
                            }
                            EventKind::Remove(_) => {
                                let _ = app.emit("entry-deleted", FileEventPayload {
                                    entry_id: entry_id.clone(),
                                    path: path.to_string_lossy().to_string().replace('\\', "/"),
                                });
                            }
                            _ => {}
                        }
                    } else {
                        // Check if inside any watched folder-ref
                        for (folder_path, folder_entry_id) in folders.iter() {
                            if path.starts_with(folder_path) {
                                let _ = app.emit("folder-changed", FolderEventPayload {
                                    entry_id: folder_entry_id.clone(),
                                    path: folder_path.to_string_lossy().to_string().replace('\\', "/"),
                                    changed_file_path: path.to_string_lossy().to_string().replace('\\', "/"),
                                });
                            }
                        }
                    }
                }
            }
        }).map_err(|e| format!("Failed to create watcher: {}", e))?;

        self.watcher = Some(watcher);
        Ok(())
    }

    pub fn watch_file(&mut self, path: PathBuf, entry_id: String) -> Result<(), String> {
        let Some(watcher) = &mut self.watcher else {
            return Err("Watcher not initialized".to_string());
        };

        let mut files = self.watched_files.lock().unwrap();
        if !files.contains_key(&path) {
            watcher.watch(&path, RecursiveMode::NonRecursive)
                .map_err(|e| format!("Failed to watch file: {}", e))?;
        }
        files.insert(path, entry_id);
        Ok(())
    }

    pub fn unwatch_file(&mut self, path: PathBuf) -> Result<(), String> {
        let Some(watcher) = &mut self.watcher else {
            return Err("Watcher not initialized".to_string());
        };

        let mut files = self.watched_files.lock().unwrap();
        if files.remove(&path).is_some() {
            let _ = watcher.unwatch(&path);
        }
        Ok(())
    }

    pub fn watch_folder(&mut self, path: PathBuf, entry_id: String) -> Result<(), String> {
        let Some(watcher) = &mut self.watcher else {
            return Err("Watcher not initialized".to_string());
        };

        let mut folders = self.watched_folders.lock().unwrap();
        if !folders.contains_key(&path) {
            watcher.watch(&path, RecursiveMode::Recursive)
                .map_err(|e| format!("Failed to watch folder: {}", e))?;
        }
        folders.insert(path, entry_id);
        Ok(())
    }

    pub fn unwatch_folder(&mut self, path: PathBuf) -> Result<(), String> {
        let Some(watcher) = &mut self.watcher else {
            return Err("Watcher not initialized".to_string());
        };

        let mut folders = self.watched_folders.lock().unwrap();
        if folders.remove(&path).is_some() {
            let _ = watcher.unwatch(&path);
        }
        Ok(())
    }

    pub fn clear_all(&mut self) {
        let Some(watcher) = &mut self.watcher else {
            return;
        };

        let mut files = self.watched_files.lock().unwrap();
        for path in files.keys() {
            let _ = watcher.unwatch(path);
        }
        files.clear();

        let mut folders = self.watched_folders.lock().unwrap();
        for path in folders.keys() {
            let _ = watcher.unwatch(path);
        }
        folders.clear();
    }
}

#[tauri::command]
pub fn watch_entry(state: State<'_, WatchState>, path: String, entry_id: String) -> Result<(), String> {
    let mut manager = state.0.lock().unwrap();
    manager.watch_file(PathBuf::from(&path), entry_id)
}

#[tauri::command]
pub fn unwatch_entry(state: State<'_, WatchState>, path: String) -> Result<(), String> {
    let mut manager = state.0.lock().unwrap();
    manager.unwatch_file(PathBuf::from(&path))
}

#[tauri::command]
pub fn watch_folder(state: State<'_, WatchState>, path: String, entry_id: String) -> Result<(), String> {
    let mut manager = state.0.lock().unwrap();
    manager.watch_folder(PathBuf::from(&path), entry_id)
}

#[tauri::command]
pub fn unwatch_folder(state: State<'_, WatchState>, path: String) -> Result<(), String> {
    let mut manager = state.0.lock().unwrap();
    manager.unwatch_folder(PathBuf::from(&path))
}

#[tauri::command]
pub fn clear_watches(state: State<'_, WatchState>) -> Result<(), String> {
    let mut manager = state.0.lock().unwrap();
    manager.clear_all();
    Ok(())
}
