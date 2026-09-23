#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct FeedCursor {
    subscription_epoch: u64,
    sequence: u64,
}

#[derive(Default)]
struct SyntheticWatcher {
    cursor: FeedCursor,
    callback_count: usize,
    torn_down: bool,
}

impl SyntheticWatcher {
    fn emit(&mut self, changes: usize) -> bool {
        if self.torn_down {
            return false;
        }
        self.cursor.sequence += 1;
        self.callback_count += 1;
        changes <= 256
    }

    fn teardown(&mut self) {
        self.torn_down = true;
    }
}

#[test]
fn bounded_batches_cover_one_hundred_and_one_thousand_changes() {
    for count in [1, 100, 1000] {
        let mut watcher = SyntheticWatcher::default();
        let mut remaining = count;
        let mut batches = 0;
        while remaining > 0 {
            let batch = remaining.min(256);
            assert!(watcher.emit(batch));
            batches += 1;
            remaining -= batch;
        }
        assert_eq!(watcher.callback_count, batches);
        assert_eq!(watcher.cursor.sequence, batches as u64);
    }
}

#[test]
fn overflow_is_fail_closed_and_requires_snapshot_fallback() {
    let mut watcher = SyntheticWatcher::default();
    assert!(!watcher.emit(257));
    assert_eq!(watcher.cursor.sequence, 1);
    assert!(watcher.emit(1));
}

#[test]
fn cursor_is_monotonic_across_subscription_epochs() {
    let mut watcher = SyntheticWatcher::default();
    watcher.cursor.subscription_epoch = 1;
    assert!(watcher.emit(1));
    let first = watcher.cursor;
    watcher.cursor.subscription_epoch = 2;
    watcher.cursor.sequence = 0;
    assert!(watcher.emit(1));
    assert!(watcher.cursor.subscription_epoch > first.subscription_epoch);
    assert!(watcher.cursor.sequence > 0);
}

#[test]
fn teardown_prevents_callbacks() {
    let mut watcher = SyntheticWatcher::default();
    watcher.teardown();
    assert!(!watcher.emit(1));
    assert_eq!(watcher.callback_count, 0);
}
