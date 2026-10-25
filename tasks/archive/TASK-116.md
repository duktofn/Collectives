## TASK-116 — Use static trusted editor contributions

**State:** Done
**Source ID:** Phase B v1.4 TASK-015; follows completed TASK-115 (plan TASK-014).
**Related:** DEC-017 (document session ownership), DEC-019 (note-link context), DEC-020 (static built-in contributions).
**Current Step:** Complete — implementation commit `94d6219`.

### Description
Replace scattered extension imports and singleton handler registrations with an internal static registry of trusted editor contributions. Preserve chart, note-link, formatting, fixed-template and command behavior with one per-EditorView install/dispose boundary.

### Scope
- `src/lib/cm-extensions/markdown-mode.ts`, `chart-widget.ts`, and new `editor-session.ts`
- `src/lib/editorCommands.ts`, `src/components/editor/Editor.tsx`
- New `src/features/builtin/editorContributions.ts` and `editorContributions.test.ts`
- `task.md`, `decisions.md`, `codebase.md`; no user-visible behavior changed, so no changelog entry was added.

### Requirements
- [x] Define an internal static trusted registry with install/dispose lifecycle; add no runtime plugin installation, third-party API, dependency, or editor mode.
- [x] Keep Chart.js lazy and preserve chart serialization, YAML, render, edit, delete and error behavior.
- [x] Preserve the TASK-115 duplicate note-link route, injected context, cancellation, stale-result checks and FolderRef readiness.
- [x] Preserve fixed templates, formatting, headings and existing editor commands.
- [x] Dispose per-view handlers and avoid duplicate registrations through mode changes, replacement and unmount.
- [x] Recheck live view/session and writable state before contribution edits; chart widgets capture and validate their EditorState session key.
- [x] Cover contribution modes and cleanup, stale/read-only commands, chart behavior, templates, undo and the duplicate note-link browser route.
- [x] Pass Windows frontend gates and affected browser regressions without weakening assertions or timeouts.
- [x] Record performance scope; no cache or editor hot-path behavior changed, so no benchmark or performance claim was needed.
- [x] Root independently audited the scoped diff and evidence. No remote writes.

### Steps
- [x] Add the static contribution registry and wire per-view lifecycle cleanup.
- [x] Run focused behavior tests and all required Windows frontend, contract, build and browser checks.
- [x] Audit, commit and record implementation hash `94d6219` before archiving.

### Handoff
- Branch: `codex/phase-b-08-11`; base: `80b7f89`.
- Next action: none. TASK-116 is complete; Phase C / TASK-016 was not started.
- Blockers: none.

### Verification
- Windows: `npm run typecheck`, `npm run lint`, `npm run check:contracts`, `npm run build`, and `npm run test -- --run --maxWorkers=2` passed. Vitest: 57 files / 349 tests.
- Focused editor suite: 3 files / 13 tests passed across the registry, command and chart-model suites.
- Browser regressions: 26 chart/editor-template cases and 5 duplicate WikiLink cases passed. The WikiLink suite used a temporary external Playwright config that was removed after the run.
- Build succeeded with Vite's large-chunk advisory; `chart.js/auto` remained a separate lazy chunk.
- Rust gates were not run. No cache or editor hot-path behavior changed; no native benchmark was run.

### Log
- 2026-10-25 — Created for the explicit request to finish Phase B TASK-015 after audited TASK-115.
- 2026-10-25 — Added the static registry, per-view command cleanup, and a session-key guard for chart edits/deletes; all required Windows checks passed.
- 2026-10-25 — Root audited the final diff and evidence; source committed as `94d6219`, then task archived. No remote writes.
