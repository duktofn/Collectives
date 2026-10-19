use notify::{recommended_watcher, Event, EventKind, RecursiveMode, Watcher};
use std::fs;
use std::sync::mpsc::channel;
use std::time::{Duration, Instant};
use tauri_app_lib::fs_layer::{
    owned_artifacts::is_owned_document_artifact,
    watcher::{WatchFeed, WatchSpec},
};
use tauri_app_lib::repositories::documents::{read_file, write_file, WritePrecondition};

#[test]
fn only_exact_owned_names_are_hidden() {
    let id = uuid::Uuid::new_v4();
    for name in [
        format!("note.md.tmp-{id}"),
        format!(".note.md.collectives-backup-{id}"),
        format!(".note.md.collectives-{id}.tmp"),
    ] {
        assert!(
            is_owned_document_artifact(std::path::Path::new(&name)),
            "{name}"
        );
    }
    for name in [
        "user.tmp-draft",
        ".note.md.collectives-backup-user",
        "note.md",
        ".tmp-",
        ".note.collectives.tmp",
    ] {
        assert!(
            !is_owned_document_artifact(std::path::Path::new(name)),
            "{name}"
        );
    }
}

#[test]
fn publication_rename_keeps_real_note_without_renaming_to_internal_path() {
    use notify::event::{ModifyKind, RenameMode};
    let root = tempfile::tempdir().unwrap();
    let note = root.path().join("note.md");
    let stage = root
        .path()
        .join(format!("note.md.tmp-{}", uuid::Uuid::new_v4()));
    let mut feed = WatchFeed::new(
        "collection",
        &[WatchSpec {
            path: note.clone(),
            entry_id: "note".into(),
            recursive: false,
        }],
    );
    for paths in [[stage.clone(), note.clone()], [note.clone(), stage]] {
        let event = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
            .add_path(paths[0].clone())
            .add_path(paths[1].clone());
        let (batch, legacy) = feed.process_events(&[event], false);
        assert_eq!(batch.changes.len(), 1);
        assert_eq!(batch.changes[0].kind, "modified");
        assert_eq!(
            batch.changes[0].path,
            tauri_app_lib::fs_ops::normalize_path(&note.to_string_lossy())
        );
        assert_eq!(legacy[0].name, "file-modified");
    }
}

#[test]
fn one_hundred_real_saves_hide_internal_events_and_tree_entries() {
    let root = tempfile::tempdir().unwrap();
    let note = root.path().join("note.md");
    fs::write(&note, "initial").unwrap();
    let (sender, receiver) = channel();
    let mut watcher = recommended_watcher(move |event: Result<Event, notify::Error>| {
        if let Ok(event) = event {
            let _ = sender.send(event);
        }
    })
    .unwrap();
    watcher
        .watch(root.path(), RecursiveMode::Recursive)
        .unwrap();
    let mut token = read_file(note.to_string_lossy().into_owned())
        .unwrap()
        .version_token;
    for index in 0..100 {
        token = write_file(
            note.to_string_lossy().into_owned(),
            format!("revision {index}"),
            WritePrecondition::Version { token },
        )
        .unwrap()
        .version_token;
    }
    let mut events = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        match receiver.recv_timeout(Duration::from_millis(500)) {
            Ok(event) => events.push(event),
            Err(_) => break,
        }
    }
    assert!(
        events
            .iter()
            .flat_map(|event| &event.paths)
            .any(|path| is_owned_document_artifact(path)),
        "raw native stream must include staging events"
    );
    let mut feed = WatchFeed::new(
        "collection",
        &[WatchSpec {
            path: root.path().into(),
            entry_id: "folder".into(),
            recursive: true,
        }],
    );
    let (batch, legacy) = feed.process_events(&events, false);
    assert!(!batch.changes.is_empty());
    for change in &batch.changes {
        for path in [
            Some(&change.path),
            change.old_path.as_ref(),
            change.changed_file_path.as_ref(),
        ]
        .into_iter()
        .flatten()
        {
            assert!(!is_owned_document_artifact(std::path::Path::new(path)));
        }
    }
    assert!(legacy
        .iter()
        .all(|event| !event.payload.to_string().contains(".tmp-")
            && !event.payload.to_string().contains(".collectives-backup-")));
    let leftover = root.path().join(format!(
        ".note.md.collectives-backup-{}",
        uuid::Uuid::new_v4()
    ));
    fs::write(leftover, "backup").unwrap();
    fs::write(root.path().join("user.tmp-draft"), "user").unwrap();
    let children = tauri_app_lib::fs_ops::read_children(root.path()).unwrap();
    assert_eq!(children.len(), 2);
    assert!(children.iter().any(|child| child.name == "user.tmp-draft"));
    assert_eq!(fs::read_to_string(note).unwrap(), "revision 99");
}
