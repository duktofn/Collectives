## TASK-001 — Reveal inline Markdown delimiters while editing

**State:** Done
**Current Step:** Step 3 — Complete

### Description
Fix invisible empty bold pairs and trapped inline formatting in Write mode. Show editable delimiters while the selection is inside inline formatting, preserving its rendered style.

### Scope
- `src/lib/cm-extensions/render-decorations.ts`, its tests, editor regression specs, `CHANGELOG.md`

### Requirements
- [x] Empty bold markers remain visible and editable.
- [x] Active bold, italic, and inline code show delimiters with styled contents.
- [x] Cursor can leave formatting and start a normal new line, including in a list.
- [x] Read mode and inactive formatting keep their rendered presentation.

### Steps
- [x] Step 1 — Inspect rendering and pairing → verify: identified unconditional hidden atomic delimiters and empty bold parsed as HorizontalRule.
- [x] Step 2 — Adjust active inline rendering → verify: targeted regression tests pass.
- [x] Step 3 — Validate real keyboard input and update changelog → verify: browser tests, typecheck, lint, build.

### Handoff
- Branch: `main`
- Base commit: `3b50d14`
- Uncommitted files: render-decorations.ts and tests, markdown-mode.ts, Editor.css, e2e/editor-inline-formatting.spec.ts; local ignored context/changelog files
- Next action: none; implementation and regression validation complete. Changes are uncommitted.
- Blockers: none

### Verification
Passed: 71 editor unit tests; 28 distinct browser tests across inline formatting, headings, code blocks, tables, selection, and history; production frontend build; lint on all changed TypeScript files; git diff --check. Visually inspected the active ordered-list bold screenshot. Full strict typecheck and lint remain blocked only by the pre-existing unused getByRole in src/App.phase4.test.tsx:36 (confirmed in HEAD). TypeScript passes with noUnusedLocals disabled. No packaged desktop release was built.

### Log
- 2026-10-18 — Created; inspected editor rendering, pairing, formatting shortcuts, and browser fixtures.

- 2026-10-18 — Step 2 complete: active inline parser marks are exposed, empty formatting stays visible, closing-boundary DOM insertion is stable; 71 editor unit tests and 28 distinct browser regressions passed. Read codebase map refreshed and DEC-001 recorded.


- 2026-10-18 — Step 3 complete: browser keyboard and mouse behavior verified, screenshot inspected, production frontend build passed, changed-file lint and diff checks passed; documented baseline typecheck/lint issue. Updated English Unreleased changelog. Done; no commit created.
