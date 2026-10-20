## TASK-102 — Characterize data integrity before refactor

**State:** Done
**Current Step:** Completed
**Phase:** Refactor plan Phase A
**Source ID:** Attached plan TASK-003

### Description
Add black-box test coverage and a concise evidence report for document persistence, collection transitions, ZIP import/export, and metadata migration before the larger refactor. Do not change production behavior in this characterization task.

### Scope
- `src/stores/editor.phase1.test.ts`
- `src/Editor.test.ts`
- `src-tauri/tests/owned_document_artifacts.rs`
- `src-tauri/tests/phase1_safety.rs`
- `src-tauri/tests/phase3_migration.rs`
- `src-tauri/tests/phase3_watcher.rs`
- `e2e/editor-missing-file.spec.ts`
- `docs/rebuild/main-baseline-data-2026-10-19.md` (new)

### Related
- `Collectives_Main_Architecture_Audit_Refactor_Plan_2026-10-19_v1.4(1).md` → Phase A / TASK-003
- `task.md` → TASK-099 (main branch protection remains paused pending an all-green hosted run)

### Requirements
- [x] Characterize own-save vs external-save, dirty switch/close, restoration, file removal and relink coverage boundaries, binary/size/BOM/newline preservation, ZIP/import interruption and migration failure.
- [x] Expected-good cases pass; any confirmed defect has a deterministic regression and is separated from unsupported scenarios.
- [x] Tests use isolated fixtures and do not modify real user data.
- [x] No production behavior change; Windows filesystem/database checks use real fixtures where required.

### Steps
- [x] Step 1 — Audit existing allowed test fixtures → verify: every requested scenario is mapped; the relink path postcondition gap is explicit.
- [x] Step 2 — Add the missing stale-save-after-removal case and baseline report → verify: focused Windows tests pass and no production files changed.
- [x] Step 3 — Run task gates and review scoped diff → verify: Windows quality gates pass; the relink coverage boundary is documented without editing an out-of-scope test.

### Handoff
- Branch: `codex/phase-a-data-integrity`; base commit: `23c2f33`; task code/report commit: `3754155`.
- Uncommitted files: pre-existing `.gitignore` edit adding `.opencode`, unrelated and preserved; no TASK-102 files remain uncommitted.
- Next action: none; TASK-102 is complete. The relink result-path assertion remains a documented coverage gap outside this task's allowed file list.
- Blockers: none for TASK-102. TASK-099 remains Paused pending an all-green hosted CI run.

### Verification
Windows 10.0.26300.0 with C: and D: on NTFS, Node 20.19.0 and Rust 1.99.0. `npm run test -- --run src/stores/editor.phase1.test.ts src/Editor.test.ts` passed (32); `npm exec -- playwright test e2e/editor-missing-file.spec.ts` passed (2). Rust targeted integration tests passed (40 total across `feature42_file_capabilities`, `owned_document_artifacts`, `phase1_safety`, `phase3_migration`, and `phase3_watcher`). Canonical frontend quality passed (typecheck, lint, 291 unit tests and production build); `npm run check:contracts`, backend quality, Rust fmt, Clippy with warnings denied and locked all-target tests passed. `git diff --check` passed. No Linux/macOS validation or hosted TASK-102 workflow run is claimed.

### Log
- 2026-10-19 — Started Phase A / plan TASK-003 at the user’s direction to switch tasks when the hosted hook run did not pass.
- 2026-10-19 — Audited existing coverage, added a real-NTFS removed-document stale-save regression, and documented the existing relink test's missing resulting-path assertion.
- 2026-10-19 — Windows task gates passed; code and baseline report committed as `3754155`.
