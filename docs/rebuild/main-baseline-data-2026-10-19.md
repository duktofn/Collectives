# Data Integrity Baseline — 2026-10-19

## Scope

This is a Windows-only characterization snapshot for the pre-refactor code at `origin/main` commit `23c2f33`. The task changed tests and this report only; it did not change application or backend production behavior. Native filesystem cases ran against temporary files on Windows NTFS.

## Coverage map

| Scenario | Existing or added fixture | Evidence and boundary |
|---|---|---|
| Own-save vs external-save | `src-tauri/tests/owned_document_artifacts.rs::one_hundred_real_saves_hide_internal_events_and_tree_entries`; `src-tauri/tests/phase1_safety.rs::conditional_write_rejects_external_change_without_replacing_draft_target` | Real NTFS writes and watcher events; an external replacement after read is rejected and its bytes remain intact. |
| Dirty switch/close and save queue | `src/stores/editor.phase1.test.ts` | State-machine tests cover failed dirty switch, close retention, queued revisions and delayed reads. IPC reads/writes are mocked. |
| Recovery | `src/stores/editor.phase1.test.ts`; `src-tauri/tests/phase1_safety.rs` recovery tests | UI/store recovery behavior uses mocked IPC; journal, backup and rollback recovery use real temporary files. |
| Missing or removed file | `e2e/editor-missing-file.spec.ts`; `src-tauri/tests/phase1_safety.rs::removed_open_document_is_not_recreated_by_a_stale_save` | The E2E verifies user-visible selection and draft behavior with a controlled IPC failure. The added NTFS case physically removes an opened note, confirms `stale_read`, then confirms a stale save returns `external_change_conflict` and does not recreate the path. |
| Relink | `src-tauri/tests/phase3_incremental.rs` relink mutation coverage | The existing SQLite-backed test exercises a relink mutation and checks mutation metrics and final IDs, but does not assert the resulting path. The relink path postcondition remains a coverage gap outside this task's allowed test files. |
| Binary, size, BOM and line endings | `src-tauri/tests/feature42_file_capabilities.rs` | Real temporary files cover binary/NUL and size rejection, UTF-8 BOM metadata, CRLF preservation and unchanged mixed-line-ending bytes. |
| ZIP/import interruption and rollback | `src-tauri/tests/phase1_safety.rs` transaction recovery and injected commit-failure cases | Journal, staged assets, backups and rollback states are exercised against isolated temporary directories; existing destination digests are checked. |
| Migration failure and restart | `src-tauri/tests/phase3_migration.rs` | Malformed input and case collisions fail before publish; successful migration preserves legacy sources and can be reopened without fallback. |
| Watcher behavior | `src-tauri/tests/phase3_watcher.rs`; `src-tauri/tests/owned_document_artifacts.rs` | Native Windows notify events are collected from temporary NTFS files and checked for scoped, ordered batches and hidden internal artifacts. |

## Findings

- No data-integrity regression was reproduced in the characterized cases.
- The added missing-file case closes a gap between mocked UI coverage and the real filesystem: an open-time version token cannot recreate a note that was removed before a stale save.
- Store and E2E tests that mock IPC establish UI behavior, not native filesystem durability. The Rust integration fixtures supply the real-file, SQLite, ZIP and watcher evidence.
- Tests model interruption by persisting transaction states and invoking recovery. They do not simulate sudden power loss or terminate the operating system during a physical disk flush.

## Windows verification

Environment: Windows 10.0.26300.0, D: and C: NTFS, Node 20.19.0 for frontend gates, Rust 1.99.0.

- `npm run test -- --run src/stores/editor.phase1.test.ts src/Editor.test.ts`: 32 tests passed.
- `npx playwright test e2e/editor-missing-file.spec.ts`: 2 tests passed.
- Targeted Rust integration tests: `feature42_file_capabilities` 5, `owned_document_artifacts` 3, `phase1_safety` 22, `phase3_migration` 7, `phase3_watcher` 3; all passed.
- Canonical frontend quality: typecheck, lint, 291 unit tests and production build passed.
- `npm run check:contracts`: passed.
- Rust 1.99.0 Windows fmt, clippy with warnings denied, and locked all-target tests passed.
- No Linux or macOS validation is claimed.
