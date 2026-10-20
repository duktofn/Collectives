## TASK-105 — Validate archive and migration rollback invariants

**State:** Done
**Current Step:** Completed
**Phase:** Refactor plan Phase A
**Source ID:** Attached plan TASK-006

### Description
Build a focused Windows fault matrix for unsafe ZIP members, duplicate destinations, cross-volume import/export, and interrupted transaction recovery. Preserve original data and existing archive semantics; change production behavior only for a deterministically reproduced defect.

### Scope
- `src-tauri/src/collection/archive.rs`
- `src-tauri/src/collection/import_transaction.rs`
- `src-tauri/src/metadata/migration.rs`
- `src-tauri/tests/phase1_safety.rs`
- `src-tauri/tests/phase3_migration.rs`
- `src-tauri/tests/archive_fault_matrix.rs` (new)
- `src/components/common/ZipConflictDialog.phase1.test.tsx`
- task ledger

### Related
- `Collectives_Main_Architecture_Audit_Refactor_Plan_2026-10-19_v1.4(1).md` → Phase A / TASK-006
- `task.md` → TASK-104 (save/watch conflict checks passed on Windows)
- `decisions.md` → DEC-013 (Windows-only verification)

### Requirements
- [x] ZIP traversal, reparse/symlink, duplicate names and ambiguous conflicts never write outside the selected destination or overwrite silently.
- [x] Cross-volume import/export preserve prior destination bytes and publish complete output only.
- [x] Abrupt restart at each journal state recovers idempotently; rollback failures preserve evidence and keep mutation blocked.
- [x] Injected faults leave the original collection accessible; no broad archive semantic change without reproduction.
- [x] Windows archive/migration tests and applicable G-CODE/G-DATA gates pass; no non-Windows validation is claimed.

### Steps
- [x] Step 1 — Audit existing ZIP validation, staging, cross-volume publication, rollback and UI conflict tests → verify: each attack/fault point is mapped to existing or missing coverage.
- [x] Step 2 — Add `archive_fault_matrix.rs` cases and strengthen conflict UI coverage → verify: traversal, symlink, duplicate and cross-volume cases preserve source/destination digests.
- [x] Step 3 — Exercise journal restart/retry/fault states and patch only any reproduced data-loss defect → verify: recovery is deterministic and idempotent.
- [x] Step 4 — Run Windows G-CODE/G-DATA checks and review the allowlisted diff → verify: no writes escape the chosen destination and rollback evidence remains recoverable.

### Handoff
- Branch: `codex/phase-a-archive-migration`; base commit: `1742d90` (completed TASK-104); task code commit: `a1b9553`.
- Uncommitted files: pre-existing `.gitignore` edit adding `.opencode`, unrelated and preserved; no TASK-105 files remain uncommitted.
- Next action: continue Phase A with plan TASK-007; push remains deferred until the phase batch is complete.
- Blockers: none for TASK-105. TASK-099 remains Paused pending a fresh hosted Windows workflow.

### Verification
Windows 10.0.26300.0 with C: and D: on NTFS, Node 24.20.0 and Rust 1.99.0. Frontend quality passed (typecheck, lint, 297 unit tests and production build); backend quality passed (fmt, Clippy with warnings denied and locked all-target tests); `npm run check:contracts` passed. The 5-case archive matrix passed for traversal, ZIP symlink, reparse junction, Windows case collision, cross-volume import/export to existing destinations, repeated committed-journal recovery, and read-only source export. Existing phase1 safety and phase3 migration suites passed (22 and 7 tests). No Linux/macOS validation or hosted TASK-105 workflow run is claimed.

### Log
- 2026-10-19 — Started Phase A / plan TASK-006 after TASK-005 passed Windows frontend/backend/contract gates; scope is restricted to the plan allowlist.
- 2026-10-19 — Audit found traversal, conflict, backup-digest, migration-restart and rollback-pending coverage, but no executable ZIP symlink/reparse matrix, Windows case-collision fixture, cross-volume import/export sequence or repeated committed-journal cleanup.
- 2026-10-19 — New fault matrix covers traversal, ZIP symlink, destination reparse, Windows case collision, explicit conflict resolution, and complete cross-volume import, ZIP export and folder export.
- 2026-10-19 — Cross-volume tests reproduced a Windows read-only-handle flush failure and non-idempotent committed journal validation after cleanup; fixed Windows file flushing and allowed already-removed owned stage roots only for committed transactions. All five matrix cases pass.
- 2026-10-19 — Extended cross-volume export to a read-only source and an existing destination with an unrelated file; the staging sync temporarily clears/restores the Windows read-only bit. A destination reparse junction is rejected before any outside write.
- 2026-10-19 — TASK-105 code committed as `a1b9553`; push remains deferred until Phase A is complete.
