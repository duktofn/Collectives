## TASK-002 — Preserve draft formatting with trailing spaces and finish it on Enter

**State:** Done
**Current Step:** Step 3 — Complete

### Description
The follow-up screenshot contains `**text **`: trailing whitespace invalidates native Markdown emphasis and drops the active preview. Preserve active draft styling, and allow Enter at the content end to finish formatting before starting the next list item or paragraph.

### Scope
- Inline draft detection/rendering and formatting keymap under `src/lib/cm-extensions/`
- Focused unit/browser regressions, context files, English Unreleased changelog

### Requirements
- [x] Active bold/italic/strike previews survive trailing spaces without altering typed text.
- [x] Enter at the end of formatted content closes formatting on the current line and preserves list continuation.
- [x] Empty formatting, code/source input, mid-content Enter, and undo/redo remain correct.

### Steps
- [x] Step 1 — Capture screenshot and Enter cases → verify: browser failures reproduce.
- [x] Step 2 — Recover active draft styling and finish inline formatting on Enter → verify: focused unit/browser regressions.
- [x] Step 3 — Review and validate → verify: editor regression suite, changed-file lint, frontend build.

### Handoff
- Branch: `main`
- Base commit: `3b50d14`
- Uncommitted files: prior TASK-001 implementation and regression files remain in place.
- Next action: none; implementation and regression validation complete. Changes remain uncommitted.
- Blockers: known baseline unused getByRole diagnostic in App.phase4.test.tsx.

### Verification
Passed: 106 editor unit tests; all 31 browser regressions across inline formatting, headings, code blocks, table selection/history; changed-file lint; frontend production build; git diff --check. Inspected the exact trailing-space screenshot showing styled bold with visible delimiters. Strict typecheck still reports only the pre-existing unused getByRole at App.phase4.test.tsx:36; typecheck with noUnusedLocals disabled passes. No packaged release was built.

### Log
- 2026-10-18 — User reported remaining invalid trailing-space bold rendering; investigated the native Markdown flanking rules and current Enter keymap.

- 2026-10-18 — Reproduced both remaining bugs with failing browser tests. Implemented shared draft span recovery, Write-only whitespace commit on exit, and terminal Enter handling; 106 editor unit regressions pass, including nested formatting, empty emphasis, code/Source exclusions, and undo/redo. DEC-002 records the approach.


- 2026-10-18 — Final validation complete. An intermediate browser run overlapped a source edit and reset the H5 fixture; rerunning all 31 cases on stable source passed. Confirmed 106 unit tests, changed-file lint, build, and diff checks pass. Updated codebase map, DEC-002, and English Unreleased changelog. Done; no commit created.
