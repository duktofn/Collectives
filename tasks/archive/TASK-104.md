## TASK-104 — Verify own-save and watcher collision safety

**State:** Done
**Current Step:** Step 4 — Run Windows G-CODE/G-DATA checks and review the allowlisted diff
**Phase:** Refactor plan Phase A
**Source ID:** Attached plan TASK-005

### Description
Exercise own-save receipts, native watcher events, external edits, and same-path replace/delete/recreate schedules. Keep external-change detection, version preconditions, durable replacement, dirty-draft retention, and save-copy recovery intact; change production code only if a deterministic test reproduces a defect.

### Scope
- `src/stores/editor.ts`
- `src/stores/collections.ts`
- `src/features/editor/metadataContinuity.ts`
- `src-tauri/src/repositories/documents.rs`
- `src-tauri/src/fs_layer/watcher.rs`
- `src/stores/editor.phase1.test.ts`
- `src/stores/collections.phase3.test.ts`
- `src-tauri/tests/phase6_watcher_stress.rs`
- `src-tauri/tests/owned_document_artifacts.rs`
- `e2e/editor-missing-file.spec.ts`
- task ledger

### Related
- `Collectives_Main_Architecture_Audit_Refactor_Plan_2026-10-19_v1.4(1).md` → Phase A / TASK-005
- `task.md` → TASK-103 (corrupt settings are now preserved and explicitly recoverable)
- `decisions.md` → DEC-014 (write preconditions) and DEC-015 (post-commit receipts)

### Requirements
- [x] Run 1,000 deterministic own-save iterations without a false external-change conflict.
- [x] Adversarial external-change schedules never silently overwrite newer verified content.
- [x] Failed writes retain the dirty draft and existing save-copy recovery remains available.
- [x] Any production change is minimal, tied to a reproduced defect, and preserves CAS and durable replacement behavior.
- [x] Windows native filesystem tests and applicable quality gates pass; no non-Windows validation is claimed.

### Steps
- [x] Step 1 — Audit save queue, version receipt, watcher normalization, and current tests → verify: deterministic schedule matrix and existing coverage are recorded.
- [x] Step 2 — Add Windows frontend/native fixtures for own-save events and external replace/delete/recreate schedules → verify: 1,000 clean own saves and adversarial writes are deterministic.
- [x] Step 3 — Fix only any reproduced false conflict or overwrite defect → verify: regression fails before the fix and passes after it; no speculative persistence rewrite.
- [x] Step 4 — Run Windows G-CODE/G-DATA checks and review the allowlisted diff → verify: dirty drafts, compare/reload and save-copy recovery remain protected.

### Handoff
- Branch: `codex/phase-a-save-watch-collision`; base commit: `fef01e9` (completed TASK-103); task code commit: `707f906`.
- Uncommitted files: pre-existing `.gitignore` edit adding `.opencode`, unrelated and preserved; no TASK-104 files remain uncommitted.
- Next action: continue Phase A with plan TASK-006; push remains deferred until the phase batch is complete.
- Blockers: none for TASK-104. TASK-099 remains Paused pending a fresh hosted Windows workflow.

### Verification
Windows 10.0.26300.0 with NTFS, Node 24.20.0 and Rust 1.99.0. Frontend quality passed (typecheck, lint, 296 unit tests and production build); backend quality passed (fmt, Clippy with warnings denied and locked all-target tests); `npm run check:contracts` passed. The real Windows notify fixture passed 1,000 conditional saves. Frontend own-save/external watcher interleavings passed (29 tests across focused editor/collection suites); native replace/delete/recreate schedules passed both before and after the final token check. No Linux/macOS validation or hosted TASK-104 workflow run is claimed.

### Log
- 2026-10-19 — Started Phase A / plan TASK-005 after TASK-004 passed local Windows quality gates; scope is limited to the plan allowlist and only reproduced production defects may be corrected.
- 2026-10-19 — Audit found receipt tokens, active-write event filtering and final-token checks already exist. Current coverage has queue tests and a 100-write real notify test, but no deterministic watcher/receipt interleaving or external replace/delete/recreate schedule; no production defect reproduced yet.
- 2026-10-19 — Added 1,000 real Windows save/watch iterations, frontend own-save and external-change interleavings, and staged external replace/delete/recreate tests.
- 2026-10-19 — The red Windows seam test reproduced an overwrite when a same-path external write landed after the final token compare but before `ReplaceFileW`. The writer now verifies the atomic replacement backup against the expected token, restores newer external bytes on mismatch, and refuses to recreate a deleted path; replace/delete/recreate regressions pass.
- 2026-10-19 — Windows frontend, backend and IPC contract gates passed; 1,000 real saves and before/after-token external replace/delete/recreate schedules pass.
- 2026-10-19 — TASK-104 code committed as `707f906`; push remains deferred until Phase A is complete.
