## TASK-004 — Polish typography number controls and remove Settings Shortcuts

**State:** Done
**Current Step:** Step 3 — Complete

### Description
Replace browser spinner arrows for Line height and Font scale with themed minus/plus controls. Remove the Shortcuts tab and its help content from Settings.

### Scope
- ThemePanel, its CSS, a shared Settings number control, and settings browser regressions
- Local changelog and codebase map

### Requirements
- [x] Line height and Font scale have consistent minus/plus controls with decimal steps and minimum bounds.
- [x] Direct numeric typing, keyboard arrows, validation, Apply, and persistence still work.
- [x] Shortcuts tab/help content and unused styling are removed.
- [x] Controls remain usable in dark/light themes and respect pending form disabling.

### Steps
- [x] Step 1 — Add native-number stepper UI and remove Shortcuts → verify: changed-file lint/typecheck diagnostics.
- [x] Step 2 — Verify appearance and numeric behavior → verify: dark/light browser tests, keyboard, validation, and saved settings.
- [x] Step 3 — Document and finish → verify: screenshots inspected, build succeeds, context/changelog updated.

### Handoff
- Branch: `main`
- Base commit: `aa41e57`
- Uncommitted files: prior code-block spacing/copy implementation and TASK-003 archive remain untouched.
- Next action: none; implementation and verification complete. Changes remain uncommitted.
- Blockers: baseline strict typecheck unused getByRole in App.phase4.test.tsx.

### Verification
Passed: all 4 settings browser regressions in dark/light, including minus/plus steps, native arrow keys, minimum bounds, empty-value recovery, invalid-input protection, Apply/persistence, and reduced motion. All 11 ThemePanel unit tests pass, including inherited disabled state for inputs and step buttons during pending Apply. Inspected both number-control screenshots. Changed-file lint, production build, and git diff --check passed. Strict typecheck still reports only the pre-existing unused getByRole in App.phase4.test.tsx:36. An intermediate screenshot-only selector failed; correcting its relative scope restored the full browser run.

### Log
- 2026-10-18 — Created; inspected current numeric inputs, Settings tabs/styles, and existing persistence/validation browser tests.

- 2026-10-18 — Added themed number steppers and removed Shortcuts markup/styles. Confirmed decimal steps, lower bounds, direct typing, keyboard input, persistence, pending form locks, and dark/light presentation. All 4 browser cases and 11 unit tests pass; build and changed-file lint pass. Updated local changelog/codebase map. Done; no commit created.
