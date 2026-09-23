use crate::ipc::dto::{
    FileEventPayload, FilesystemChangeV2, FilesystemChangesV2, FolderEventPayload,
    RenameEventPayload,
};
use notify::{
    event::{ModifyKind, RenameMode},
    recommended_watcher, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use std::collections::HashMap;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc::sync_channel, Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

pub struct WatchManager {
    watcher: Option<RecommendedWatcher>,
    watched_files: Arc<Mutex<HashMap<PathBuf, String>>>,
    watched_folders: Arc<Mutex<HashMap<PathBuf, String>>>,
    collection_id: Arc<Mutex<String>>,
    app_handle: Option<AppHandle>,
    cursor: Arc<Mutex<WatchCursor>>,
}

pub struct WatchState(pub Arc<Mutex<WatchManager>>);

#[derive(Debug, Clone)]
pub struct WatchSpec {
    pub path: PathBuf,
    pub entry_id: String,
    pub recursive: bool,
}

pub const WATCH_BATCH_WINDOW_MS: u64 = 150;
pub const WATCH_BATCH_MAX: usize = 256;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WatchCursor {
    pub stream_id: String,
    pub subscription_epoch: String,
    pub sequence: u64,
}

#[derive(Debug, Clone)]
pub struct WatchBatchCursor {
    pub stream_id: String,
    pub subscription_epoch: String,
    pub sequence: u64,
    shared: Option<Arc<Mutex<WatchCursor>>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct WatchLegacyEvent {
    pub name: String,
    pub payload: serde_json::Value,
}

pub struct WatchFeed {
    pub collection_id: String,
    pub files: HashMap<PathBuf, String>,
    pub folders: HashMap<PathBuf, String>,
    pub cursor: WatchBatchCursor,
}

impl WatchFeed {
    pub fn new(collection_id: impl Into<String>, specs: &[WatchSpec]) -> Self {
        Self {
            collection_id: collection_id.into(),
            files: specs
                .iter()
                .filter(|spec| !spec.recursive)
                .map(|spec| (spec.path.clone(), spec.entry_id.clone()))
                .collect(),
            folders: specs
                .iter()
                .filter(|spec| spec.recursive)
                .map(|spec| (spec.path.clone(), spec.entry_id.clone()))
                .collect(),
            cursor: WatchBatchCursor::new(),
        }
    }

    pub fn process_events(
        &mut self,
        events: &[notify::Event],
        overflow: bool,
    ) -> (FilesystemChangesV2, Vec<WatchLegacyEvent>) {
        let mut changes = Vec::new();
        let mut legacy = Vec::new();
        for event in events {
            let before = changes.len();
            collect_test_events(event, &self.files, &self.folders, &mut changes, &mut legacy);
            for change in changes.iter().skip(before) {
                if change.kind == "renamed" {
                    if let (Some(entry_id), Some(old_path)) =
                        (change.entry_id.clone(), change.old_path.clone())
                    {
                        self.files.remove(&PathBuf::from(old_path));
                        self.files
                            .insert(PathBuf::from(change.path.clone()), entry_id);
                    }
                }
            }
        }
        (
            self.cursor
                .next(self.collection_id.clone(), overflow, changes),
            legacy,
        )
    }

    pub fn restart(&mut self) {
        self.cursor = WatchBatchCursor::new();
    }
}

impl WatchBatchCursor {
    pub fn new() -> Self {
        Self {
            stream_id: Uuid::new_v4().to_string(),
            subscription_epoch: Uuid::new_v4().to_string(),
            sequence: 0,
            shared: None,
        }
    }
    fn with_shared(shared: Arc<Mutex<WatchCursor>>) -> Self {
        let cursor = shared.lock().unwrap().clone();
        Self {
            stream_id: cursor.stream_id,
            subscription_epoch: cursor.subscription_epoch,
            sequence: cursor.sequence,
            shared: Some(shared),
        }
    }
    pub fn next(
        &mut self,
        collection_id: String,
        overflow: bool,
        changes: Vec<FilesystemChangeV2>,
    ) -> FilesystemChangesV2 {
        if let Some(shared) = &self.shared {
            let cursor = shared.lock().unwrap().clone();
            self.stream_id = cursor.stream_id;
            self.subscription_epoch = cursor.subscription_epoch;
            self.sequence = cursor.sequence;
        }
        self.sequence = self.sequence.saturating_add(1);
        if let Some(shared) = &self.shared {
            *shared.lock().unwrap() = WatchCursor {
                stream_id: self.stream_id.clone(),
                subscription_epoch: self.subscription_epoch.clone(),
                sequence: self.sequence,
            };
        }
        FilesystemChangesV2 {
            collection_id,
            stream_id: self.stream_id.clone(),
            subscription_epoch: self.subscription_epoch.clone(),
            sequence: self.sequence,
            overflow,
            changes,
        }
    }
}

impl Default for WatchBatchCursor {
    fn default() -> Self {
        Self::new()
    }
}

impl WatchManager {
    pub fn new() -> Self {
        Self {
            watcher: None,
            watched_files: Arc::new(Mutex::new(HashMap::new())),
            watched_folders: Arc::new(Mutex::new(HashMap::new())),
            collection_id: Arc::new(Mutex::new(String::new())),
            app_handle: None,
            cursor: Arc::new(Mutex::new(WatchCursor {
                stream_id: Uuid::new_v4().to_string(),
                subscription_epoch: Uuid::new_v4().to_string(),
                sequence: 0,
            })),
        }
    }

    pub fn init(&mut self, app: AppHandle) -> Result<(), String> {
        self.app_handle = Some(app.clone());
        let watched_files = Arc::clone(&self.watched_files);
        let watched_folders = Arc::clone(&self.watched_folders);
        let collection_id = Arc::clone(&self.collection_id);
        let overflow = Arc::new(AtomicBool::new(false));
        let overflow_for_callback = Arc::clone(&overflow);
        let cursor_state = Arc::clone(&self.cursor);
        let (sender, receiver) = sync_channel::<notify::Event>(1024);
        let callback = move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                if sender.try_send(event).is_err() {
                    overflow_for_callback.store(true, Ordering::Release);
                }
            }
        };
        let worker_app = app.clone();
        thread::spawn(move || {
            let mut cursor = WatchBatchCursor::with_shared(cursor_state);
            loop {
                let first =
                    match receiver.recv_timeout(Duration::from_millis(WATCH_BATCH_WINDOW_MS)) {
                        Ok(event) => event,
                        Err(_) => continue,
                    };
                let mut events = vec![first];
                while events.len() < WATCH_BATCH_MAX {
                    match receiver.try_recv() {
                        Ok(event) => events.push(event),
                        Err(_) => break,
                    }
                }
                let overflowed = overflow.swap(false, Ordering::AcqRel);
                let files = watched_files.lock().unwrap().clone();
                let folders = watched_folders.lock().unwrap().clone();
                let current_collection = collection_id.lock().unwrap().clone();
                let mut changes = Vec::new();
                for event in &events {
                    emit_legacy_and_collect(&worker_app, event, &files, &folders, &mut changes);
                }
                if !changes.is_empty() || overflowed {
                    let _ = worker_app.emit(
                        "filesystem-changes-v2",
                        cursor.next(current_collection.clone(), overflowed, changes),
                    );
                }
            }
        });
        let watcher = recommended_watcher(callback)
            .map_err(|e| format!("Failed to create watcher: {}", e))?;

        self.watcher = Some(watcher);
        Ok(())
    }

    pub fn watch_file(&mut self, path: PathBuf, entry_id: String) -> Result<(), String> {
        let Some(watcher) = &mut self.watcher else {
            return Err("Watcher not initialized".to_string());
        };

        let mut files = self.watched_files.lock().unwrap();
        if !files.contains_key(&path) {
            watcher
                .watch(&path, RecursiveMode::NonRecursive)
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
            watcher
                .watch(&path, RecursiveMode::Recursive)
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

    pub fn sync_paths(&mut self, paths: Vec<PathBuf>) -> Result<(), String> {
        let desired: HashSet<PathBuf> = paths.into_iter().collect();
        let existing: Vec<PathBuf> = self.watched_files.lock().unwrap().keys().cloned().collect();
        for path in existing {
            if !desired.contains(&path) {
                self.unwatch_file(path)?;
            }
        }
        for path in desired {
            if !self.watched_files.lock().unwrap().contains_key(&path) {
                let entry_id = path.to_string_lossy().into_owned();
                self.watch_file(path, entry_id)?;
            }
        }
        Ok(())
    }

    pub fn sync_collection_paths(
        &mut self,
        collection_id: String,
        paths: Vec<PathBuf>,
    ) -> Result<(), String> {
        *self.collection_id.lock().unwrap() = collection_id;
        *self.cursor.lock().unwrap() = WatchCursor {
            stream_id: Uuid::new_v4().to_string(),
            subscription_epoch: Uuid::new_v4().to_string(),
            sequence: 0,
        };
        self.sync_paths(paths)
    }

    pub fn sync_collection_specs(
        &mut self,
        collection_id: String,
        specs: Vec<WatchSpec>,
    ) -> Result<(), String> {
        *self.collection_id.lock().unwrap() = collection_id;
        *self.cursor.lock().unwrap() = WatchCursor {
            stream_id: Uuid::new_v4().to_string(),
            subscription_epoch: Uuid::new_v4().to_string(),
            sequence: 0,
        };
        let desired_files: HashMap<PathBuf, String> = specs
            .iter()
            .filter(|spec| !spec.recursive)
            .map(|spec| (spec.path.clone(), spec.entry_id.clone()))
            .collect();
        let desired_folders: HashMap<PathBuf, String> = specs
            .iter()
            .filter(|spec| spec.recursive)
            .map(|spec| (spec.path.clone(), spec.entry_id.clone()))
            .collect();
        let existing_files: Vec<PathBuf> =
            self.watched_files.lock().unwrap().keys().cloned().collect();
        let existing_folders: Vec<PathBuf> = self
            .watched_folders
            .lock()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        for path in existing_files {
            if !desired_files.contains_key(&path) {
                self.unwatch_file(path)?;
            }
        }
        for path in existing_folders {
            if !desired_folders.contains_key(&path) {
                self.unwatch_folder(path)?;
            }
        }
        for (path, entry_id) in desired_files {
            self.watch_file(path, entry_id)?;
        }
        for (path, entry_id) in desired_folders {
            self.watch_folder(path, entry_id)?;
        }
        Ok(())
    }

    pub fn current_cursor(&self) -> WatchCursor {
        self.cursor.lock().unwrap().clone()
    }
}

impl Default for WatchManager {
    fn default() -> Self {
        Self::new()
    }
}

fn collect_test_events(
    event: &notify::Event,
    files: &HashMap<PathBuf, String>,
    folders: &HashMap<PathBuf, String>,
    changes: &mut Vec<FilesystemChangeV2>,
    legacy: &mut Vec<WatchLegacyEvent>,
) {
    for path in &event.paths {
        if let Some(entry_id) = files.get(path) {
            match &event.kind {
                EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if event.paths.len() >= 2 => {
                    let old_path = crate::fs_ops::normalize_path(&event.paths[0].to_string_lossy());
                    let new_path = crate::fs_ops::normalize_path(&event.paths[1].to_string_lossy());
                    legacy.push(WatchLegacyEvent { name: "entry-renamed".into(), payload: serde_json::json!({"entryId":entry_id,"oldPath":old_path,"newPath":new_path}) });
                    changes.push(FilesystemChangeV2 {
                        kind: "renamed".into(),
                        entry_id: Some(entry_id.clone()),
                        path: new_path,
                        old_path: Some(old_path),
                        changed_file_path: None,
                    });
                }
                EventKind::Modify(_) => {
                    let normalized = crate::fs_ops::normalize_path(&path.to_string_lossy());
                    legacy.push(WatchLegacyEvent {
                        name: "file-modified".into(),
                        payload: serde_json::json!({"entryId":entry_id,"path":normalized}),
                    });
                    changes.push(FilesystemChangeV2 {
                        kind: "modified".into(),
                        entry_id: Some(entry_id.clone()),
                        path: normalized,
                        old_path: None,
                        changed_file_path: None,
                    });
                }
                EventKind::Remove(_) => {
                    let normalized = crate::fs_ops::normalize_path(&path.to_string_lossy());
                    legacy.push(WatchLegacyEvent {
                        name: "entry-deleted".into(),
                        payload: serde_json::json!({"entryId":entry_id,"path":normalized}),
                    });
                    changes.push(FilesystemChangeV2 {
                        kind: "deleted".into(),
                        entry_id: Some(entry_id.clone()),
                        path: normalized,
                        old_path: None,
                        changed_file_path: None,
                    });
                }
                _ => {}
            }
        } else {
            for (folder_path, folder_entry_id) in folders {
                if path.starts_with(folder_path) {
                    let folder = crate::fs_ops::normalize_path(&folder_path.to_string_lossy());
                    let changed = crate::fs_ops::normalize_path(&path.to_string_lossy());
                    legacy.push(WatchLegacyEvent { name:"folder-changed".into(),payload:serde_json::json!({"entryId":folder_entry_id,"path":folder,"changedFilePath":changed}) });
                    changes.push(FilesystemChangeV2 {
                        kind: "folder-changed".into(),
                        entry_id: Some(folder_entry_id.clone()),
                        path: folder,
                        old_path: None,
                        changed_file_path: Some(changed),
                    });
                }
            }
        }
    }
}

fn emit_legacy_and_collect(
    app: &AppHandle,
    event: &notify::Event,
    files: &HashMap<PathBuf, String>,
    folders: &HashMap<PathBuf, String>,
    changes: &mut Vec<FilesystemChangeV2>,
) {
    for path in &event.paths {
        if let Some(entry_id) = files.get(path) {
            match &event.kind {
                EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if event.paths.len() >= 2 => {
                    let old_path = crate::fs_ops::normalize_path(&event.paths[0].to_string_lossy());
                    let new_path = crate::fs_ops::normalize_path(&event.paths[1].to_string_lossy());
                    let _ = app.emit(
                        "entry-renamed",
                        RenameEventPayload {
                            entry_id: entry_id.clone(),
                            old_path: old_path.clone(),
                            new_path: new_path.clone(),
                        },
                    );
                    changes.push(FilesystemChangeV2 {
                        kind: "renamed".to_string(),
                        entry_id: Some(entry_id.clone()),
                        path: new_path,
                        old_path: Some(old_path),
                        changed_file_path: None,
                    });
                }
                EventKind::Modify(_) => {
                    let normalized = crate::fs_ops::normalize_path(&path.to_string_lossy());
                    let _ = app.emit(
                        "file-modified",
                        FileEventPayload {
                            entry_id: entry_id.clone(),
                            path: normalized.clone(),
                        },
                    );
                    changes.push(FilesystemChangeV2 {
                        kind: "modified".to_string(),
                        entry_id: Some(entry_id.clone()),
                        path: normalized,
                        old_path: None,
                        changed_file_path: None,
                    });
                }
                EventKind::Remove(_) => {
                    let normalized = crate::fs_ops::normalize_path(&path.to_string_lossy());
                    let _ = app.emit(
                        "entry-deleted",
                        FileEventPayload {
                            entry_id: entry_id.clone(),
                            path: normalized.clone(),
                        },
                    );
                    changes.push(FilesystemChangeV2 {
                        kind: "deleted".to_string(),
                        entry_id: Some(entry_id.clone()),
                        path: normalized,
                        old_path: None,
                        changed_file_path: None,
                    });
                }
                _ => {}
            }
        } else {
            for (folder_path, folder_entry_id) in folders {
                if path.starts_with(folder_path) {
                    let normalized_folder =
                        crate::fs_ops::normalize_path(&folder_path.to_string_lossy());
                    let normalized_path = crate::fs_ops::normalize_path(&path.to_string_lossy());
                    let _ = app.emit(
                        "folder-changed",
                        FolderEventPayload {
                            entry_id: folder_entry_id.clone(),
                            path: normalized_folder.clone(),
                            changed_file_path: normalized_path.clone(),
                        },
                    );
                    changes.push(FilesystemChangeV2 {
                        kind: "folder-changed".to_string(),
                        entry_id: Some(folder_entry_id.clone()),
                        path: normalized_folder,
                        old_path: None,
                        changed_file_path: Some(normalized_path),
                    });
                }
            }
        }
    }
}

pub fn watch_entry(
    state: State<'_, WatchState>,
    path: String,
    entry_id: String,
) -> Result<(), String> {
    let mut manager = state.0.lock().unwrap();
    manager.watch_file(PathBuf::from(&path), entry_id)
}

pub fn unwatch_entry(state: State<'_, WatchState>, path: String) -> Result<(), String> {
    let mut manager = state.0.lock().unwrap();
    manager.unwatch_file(PathBuf::from(&path))
}

pub fn watch_folder(
    state: State<'_, WatchState>,
    path: String,
    entry_id: String,
) -> Result<(), String> {
    let mut manager = state.0.lock().unwrap();
    manager.watch_folder(PathBuf::from(&path), entry_id)
}

pub fn unwatch_folder(state: State<'_, WatchState>, path: String) -> Result<(), String> {
    let mut manager = state.0.lock().unwrap();
    manager.unwatch_folder(PathBuf::from(&path))
}

pub fn clear_watches(state: State<'_, WatchState>) -> Result<(), String> {
    let mut manager = state.0.lock().unwrap();
    manager.clear_all();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_cursor_is_bounded_and_monotonic() {
        let mut cursor = WatchBatchCursor::new();
        let first = cursor.next("c".into(), false, Vec::new());
        let second = cursor.next("c".into(), true, Vec::new());
        assert_eq!(WATCH_BATCH_WINDOW_MS, 150);
        assert_eq!(WATCH_BATCH_MAX, 256);
        assert_eq!(first.sequence, 1);
        assert_eq!(second.sequence, 2);
        assert!(second.overflow);
        assert_eq!(first.stream_id, second.stream_id);
        assert_ne!(first.subscription_epoch, "");
    }
}
