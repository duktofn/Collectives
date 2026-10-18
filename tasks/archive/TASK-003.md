## TASK-003 — Copy code by clicking its language label

**State:** Done
**Current Step:** Step 3 — Complete

### Description
Make the code-block language label copy that block's current contents without Markdown fences, with success/failure feedback and keyboard activation.

### Scope
- `src/lib/cm-extensions/code-block-widget.ts`, `src/components/editor/Editor.css`
- Code-block browser regressions, local changelog and codebase context

### Requirements
- [x] Click/Enter/Space on the language label copies only its block's current body, preserving indentation and intentional blank lines.
- [x] Copy works in Read and inactive Write blocks without changing editor content or selection.
- [x] Success/failure feedback and retry work; keyboard focus is visible.

### Steps
- [x] Step 1 — Implement native button and live block lookup → verify: code review and changed-file lint.
- [x] Step 2 — Verify clipboard and editor behavior → verify: browser tests for both modes, moved/edited blocks, blank/unterminated blocks, failure/retry.
- [x] Step 3 — Document and finalize → verify: changelog/map updated and production build.

### Handoff
- Branch: `main`
- Base commit: `aa41e57`
- Uncommitted files: prior code-block spacing changes in Editor.css and code-block-widget.ts.
- Next action: none; implementation and verification complete. Changes remain uncommitted.
- Blockers: baseline strict typecheck unused getByRole warning in App.phase4.test.tsx.

### Verification
Passed: all 15 code-block browser tests, including actual clipboard reads in Read/Write, mouse and Enter/Space activation, edited/moved blocks, preserved tabs/blank lines, empty/unterminated/longer-fenced blocks, failure/retry/reset, and existing pointer/selection regressions. Changed-file lint, production frontend build, and diff checks passed. Strict typecheck reports only the known pre-existing unused getByRole in App.phase4.test.tsx:36. Windows clipboard comparisons normalize CRLF to LF without trimming content.

### Log
- 2026-10-18 — Created; reviewed code-block decorations, pointer handling, existing clipboard usage, and app announcements.

- 2026-10-18 — Implemented live code-block copy buttons, feedback, timer cleanup, and keyboard focus styling. Initial clipboard assertions exposed Windows newline normalization; adjusted only test comparison. All 15 browser cases and changed-file lint passed; production build passed. Updated local changelog and codebase map. Done; no commit created.
