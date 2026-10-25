## TASK-117 — Run duplicate WikiLink browser regressions in default Playwright CI

**State:** Done
**Source ID:** Follow-up to Phase B v1.4 TASK-015 / completed TASK-116.
**Current Step:** Complete — implementation commit `3e7ae5f`.

### Description
Ensure `e2e/note-wikilink-duplicates.spec.ts` is discovered by the repository's default Playwright configuration so CI runs all five duplicate WikiLink regression tests.

### Scope
- `playwright.config.ts`
- `task.md`, `tasks/archive/TASK-117.md`

### Acceptance
- [x] The default `npx playwright test --list` includes all five duplicate WikiLink tests.
- [x] All five pass with the default configuration.
- [x] No unrelated selectors or browser settings changed; validation stayed Windows-only.
- [x] Commit `3e7ae5f` recorded before archiving.

### Handoff
- Branch: `codex/phase-b-08-11`; base: `89b72b1`.
- Next action: none. The default Playwright matcher now includes the duplicate WikiLink spec.
- Blockers: none.

### Verification
- `npx playwright test --list`: 132 tests in 25 files, including the five tests in `note-wikilink-duplicates.spec.ts`.
- `npx playwright test e2e/note-wikilink-duplicates.spec.ts --list`: all five tests discovered using the default config.
- `npx playwright test e2e/note-wikilink-duplicates.spec.ts`: 5/5 passed using the default config.
- No Rust, unit, or native performance checks were needed for this test-selector correction.

### Log
- 2026-10-25 — Created after audit found the WikiLink browser spec was absent from default Playwright discovery.
- 2026-10-25 — Added its exact filename to the default matcher; discovery and browser checks passed. Committed as `3e7ae5f`, then archived. No remote writes.
