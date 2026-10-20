## TASK-103 — Prevent silent settings loss on corrupt configuration

**State:** Done
**Current Step:** Completed
**Phase:** Refactor plan Phase A
**Source ID:** Attached plan TASK-004

### Description
Distinguish first launch from unreadable, malformed, or future-version settings; preserve the original file for diagnosis and require an explicit user recovery choice before defaults can replace it. Keep valid existing preferences, custom themes, fonts, and IPC compatibility intact.

### Scope
- `src-tauri/src/settings.rs`
- `src-tauri/src/ipc/commands/settings.rs`
- `src-tauri/src/application/services.rs`
- `src/features/settings/application.ts`
- `src/features/settings/infrastructure/ipc.ts`
- `src/App.tsx`
- `src/components/theme/ThemePanel.tsx`
- `src/types/index.ts`
- `contracts/ipc.v1.json`
- `src/shared/ipc/client.ts`
- `src/shared/ipc/generated.ts`
- `src-tauri/src/ipc/generated.rs`
- `src-tauri/tests/settings_integrity.rs` (new)
- `src/components/theme/ThemePanel.test.tsx`
- task ledger

### Related
- `Collectives_Main_Architecture_Audit_Refactor_Plan_2026-10-19_v1.4(1).md` → Phase A / TASK-004
- Plan decision register → DEC-CORE-02 (preserve settings bytes and require an explicit recovery/reset choice)
- `task.md` → TASK-102 (Windows data-integrity baseline)
- `decisions.md` → DEC-013 (Windows-only verification)

### Requirements
- [x] Invalid JSON, read denial, future schema, and failed recovery preserve the previous bytes.
- [x] Valid legacy/current settings round-trip, including custom themes and fonts.
- [x] The UI clearly explains the failure and requires an explicit user choice before replacing corrupt settings with defaults.
- [x] IPC contracts and generated types stay synchronized.
- [x] All changes stay within the allowlist; no unrelated behavior or platform changes.

### Steps
- [x] Step 1 — Audit backend load/save, startup, UI and IPC contracts → verify: missing/corrupt/read-denied/future-version paths and existing compatibility are recorded.
- [x] Step 2 — Choose and record the recovery API/state model → verify: original bytes remain recoverable and normal startup cannot overwrite them silently.
- [x] Step 3 — Implement explicit recovery and migration-compatible settings flow → verify: valid settings and explicit recovery paths work end to end.
- [x] Step 4 — Add native-file and UI regressions; regenerate/check contracts → verify: failure cases preserve bytes and custom themes/fonts round-trip.
- [x] Step 5 — Run Windows quality gates and review the allowlisted diff → verify: applicable G-CODE/G-DATA/G-UX gates pass.

### Handoff
- Branch: `codex/phase-a-settings-integrity`; base commit: `7a2acd4`; task code commit: `b9237a3`.
- Uncommitted files: pre-existing `.gitignore` edit adding `.opencode`, unrelated and preserved; no TASK-103 files remain uncommitted.
- Next action: continue Phase A with plan TASK-005; defer pushing the branch until the phase batch is complete, as requested.
- Blockers: none for TASK-103. TASK-099 remains Paused pending a fresh hosted Windows workflow.

### Verification
Windows 10.0.26300.0 with NTFS, Node 24.20.0 and Rust 1.99.0. Frontend quality passed (typecheck, lint, 294 unit tests, production build); the browser suite passed 126 tests and Phase 6 passed 5 tests after limiting the recovery dialog to classified settings-file errors. Backend quality passed (fmt, Clippy with warnings denied, locked all-target tests); 9 settings integration tests and 14 ThemePanel tests passed. `npm run check:contracts` and `git diff --check` passed. No Linux/macOS validation or hosted TASK-103 workflow run is claimed.

### Log
- 2026-10-19 — Started Phase A / plan TASK-004 after completing Windows data-integrity characterization and following the user's instruction to switch tasks rather than wait on a non-passing hosted CI gate.
- 2026-10-19 — Audit confirmed settings reads currently collapse read/parse errors to defaults, no persisted schema marker exists, and app startup cannot tell first launch from corruption. Plan decision DEC-CORE-02 governs recovery behavior.
- 2026-10-19 — Contract boundary initially caught direct settings access in the application service; checked loading and explicit recovery now stay in the allowed settings command, and contract/boundary checks pass.
- 2026-10-19 — Frontend/backend quality and file/UI regressions pass on Windows. A generic test-harness IPC error initially opened the recovery dialog; it now opens only for classified settings-file errors, and Phase 6 passes 5/5.
- 2026-10-19 — TASK-103 code committed as `b9237a3`; remote push is deferred until Phase A is complete.
