use notify::{
    event::{ModifyKind, RenameMode},
    recommended_watcher, Event, EventKind, RecursiveMode, Watcher,
};
use std::fs;
use std::sync::mpsc::{sync_channel, Receiver};
use std::thread;
use std::time::{Duration, Instant};
use tauri_app_lib::fs_layer::watcher::{
    WatchFeed, WatchSpec, WATCH_BATCH_MAX, WATCH_BATCH_WINDOW_MS,
};

fn drain_batch(receiver: &Receiver<Event>, feed: &mut WatchFeed) -> Option<(u64, usize)> {
    let first = receiver.recv_timeout(Duration::from_secs(3)).ok()?;
    let start = Instant::now();
    let mut events = vec![first];
    while start.elapsed() < Duration::from_millis(WATCH_BATCH_WINDOW_MS)
        && events.len() < WATCH_BATCH_MAX
    {
        match receiver.try_recv() {
            Ok(event) => events.push(event),
            Err(_) => thread::sleep(Duration::from_millis(2)),
        }
    }
    let (batch, _) = feed.process_events(&events, false);
    Some((batch.sequence, batch.changes.len()))
}

#[test]
fn real_temp_notify_writes_at_one_one_hundred_and_one_thousand_produce_scoped_batches() {
    let temp = tempfile::tempdir().unwrap();
    let (sender, receiver) = sync_channel(4096);
    let mut watcher = recommended_watcher(move |result: Result<Event, notify::Error>| {
        if let Ok(event) = result {
            let _ = sender.try_send(event);
        }
    })
    .unwrap();
    watcher
        .watch(temp.path(), RecursiveMode::Recursive)
        .unwrap();
    let mut feed = WatchFeed::new(
        "collection-real",
        &[WatchSpec {
            path: temp.path().to_path_buf(),
            entry_id: "folder-ref".into(),
            recursive: true,
        }],
    );
    for count in [1usize, 100, 1_000] {
        for index in 0..count {
            fs::write(
                temp.path().join(format!("batch-{count}-{index}.md")),
                b"notify",
            )
            .unwrap();
        }
        let (sequence, changes) =
            drain_batch(&receiver, &mut feed).expect("notify should produce a batch");
        assert!(sequence >= 1);
        assert!(
            changes >= 1,
            "at least one real filesystem change should be represented"
        );
    }
}

#[test]
fn notify_feed_batches_rename_delete_order_legacy_wires_and_restart_epoch() {
    let temp = tempfile::tempdir().unwrap();
    let old_path = temp.path().join("old.md");
    let new_path = temp.path().join("new.md");
    let spec = WatchSpec {
        path: old_path.clone(),
        entry_id: "entry-1".into(),
        recursive: false,
    };
    let mut feed = WatchFeed::new("collection-semantic", &[spec]);
    let rename = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
        .add_path(old_path.clone())
        .add_path(new_path.clone());
    let remove =
        Event::new(EventKind::Remove(notify::event::RemoveKind::File)).add_path(new_path.clone());
    let (renamed, legacy_rename) = feed.process_events(&[rename], false);
    assert_eq!(renamed.collection_id, "collection-semantic");
    assert_eq!(renamed.sequence, 1);
    assert_eq!(renamed.changes[0].kind, "renamed");
    assert_eq!(legacy_rename[0].name, "entry-renamed");
    let (deleted, legacy_delete) = feed.process_events(&[remove], false);
    assert_eq!(deleted.sequence, 2);
    assert_eq!(deleted.changes[0].kind, "deleted");
    assert_eq!(legacy_delete[0].name, "entry-deleted");
    let stream = deleted.stream_id.clone();
    let epoch = deleted.subscription_epoch.clone();
    let (overflow, _) = feed.process_events(&[], true);
    assert!(overflow.overflow);
    feed.restart();
    let (restarted, _) = feed.process_events(&[], false);
    assert_ne!(restarted.stream_id, stream);
    assert_ne!(restarted.subscription_epoch, epoch);
}

#[test]
fn real_temp_notify_folder_changes_keep_legacy_payload_contract() {
    let temp = tempfile::tempdir().unwrap();
    let (sender, receiver) = sync_channel(256);
    let mut watcher = recommended_watcher(move |result: Result<Event, notify::Error>| {
        if let Ok(event) = result {
            let _ = sender.try_send(event);
        }
    })
    .unwrap();
    watcher
        .watch(temp.path(), RecursiveMode::Recursive)
        .unwrap();
    let mut feed = WatchFeed::new(
        "collection-folder",
        &[WatchSpec {
            path: temp.path().to_path_buf(),
            entry_id: "folder-1".into(),
            recursive: true,
        }],
    );
    let child = temp.path().join("note.md");
    fs::write(&child, b"one").unwrap();
    let event = receiver.recv_timeout(Duration::from_secs(3)).unwrap();
    let (batch, legacy) = feed.process_events(&[event], false);
    assert_eq!(batch.collection_id, "collection-folder");
    assert!(!batch.changes.is_empty());
    assert!(legacy.iter().any(|event| event.name == "folder-changed"));
}
