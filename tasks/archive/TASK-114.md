## TASK-114 — Optimize table, code block and Markdown decorations

**State:** Done
**Source ID:** Phase B v1.4 TASK-013; depends on completed TASK-113 (plan TASK-012).
**Current Step:** Complete — implementation commit 92581cf.

### Scope
- src/lib/cm-extensions/table-widget.ts, code-block-widget.ts, render-decorations.ts, table-model.ts
- src/lib/cm-extensions/table-model.test.ts, render-decorations.test.ts, code-block-pointer.test.ts
- e2e/editor-table-interaction.spec.ts, editor-code-block-interaction.spec.ts, write-cursor.spec.ts
- src/components/editor/Editor.css (user-added heading typography scope)
- Minimal task/context/decision/changelog records and ignored measurement artifacts.

### Acceptance
- Profile full-tree rebuilds; optimize only dominant paths and reduce unaffected-range work.
- Preserve CodeMirror range mapping, height measurements, Markdown bytes, selection/pointer behavior, Read/Write/Source modes, undo and background parser refresh. No new editor mode.
- User addition: reveal heading hash markers while the Write selection is inside a heading, hide them again outside/Read, and use Bold or Semi Bold for all six heading levels.
- Windows frontend typecheck/lint/full tests/contracts/build and affected table/code/cursor browser regressions pass; do not weaken assertions or timeouts.
- Native Windows widget-editing p95 improves against frozen baseline: fixed fixture, >=2 fresh sessions, 5 warmups + >=20 samples; record p50/p95/errors/CPU/process-tree RAM and correctness. No global typing-budget or hosted-CI claim.
- Focused task-ID commit, record hash and archive only after checks pass. No remote writes.

### Steps
- [x] Profile/capture baseline → verify: immutable runner, source/binary/fixture hashes and measured dominant rebuild costs.
- [x] Optimize dominant paths → verify: focused mapping/parser/undo regression tests.
- [x] Validate Windows correctness/performance → verify: required frontend gates, browser suites and native comparison.
- [x] Audit and commit → verify: scoped diff, recorded hash and clean worktree.

### Handoff
- Branch: codex/phase-b-08-11; initial HEAD 70ea3a4; source clean at start.
- Next action: none. DEC-018 records the reuse strategy.
- Blockers: none. TASK-014, TASK-022 and TASK-086 remain Paused.

### Verification
Baseline: `artifacts/phase0/task114-baseline-1792633419038/performance.json`, two fresh native sessions with 5 warmups + 20 samples each. Fixed mixed document has 150 tables and 150 code fences (162,054 characters); each measured sample types 10 native keyboard characters followed by two animation frames, with reset outside the timed window. Baseline p50/p95 231.3/279.7 ms, CPU p95 1.03125 s, process-tree RSS p95 664,371,200 bytes. Fixture source and actual searched/editor file bytes are preserved and sessions exit cleanly. This measures preloaded widget editing, not cold-open/global typing budgets.

- Frontend: final typecheck/lint/contracts pass; 54 unit files / 333 tests pass with `--maxWorkers=2`, with no unhandled errors. Browser suites pass 27 table/code/cursor cases plus 19 selection/history/inline cases. The initial new unit shape-edit test exposed jsdom's missing scrollIntoView; only its fixture cells receive a test stub, with production assertions/timeouts unchanged.
- Native build: Rust 1.99.0 x86_64-pc-windows-msvc; frozen candidate `artifacts/phase0/task114-candidate-build-b5895ff7f96b4c5aa8ee00e7cbd761a6/tauri-app-task114.exe`, SHA-256 `52183f9d316a88cda75871f685a34c993dcb831712b04a35cc96931d548e2dff`. Build source hashes match current code; phase0 identifier only. Existing bundle-size advisory remains.
- Controlled remeasurement adds explicit assertions that all 150 tables and 150 code labels are present before measuring, in both baseline and candidate. Two fresh sessions each, 5 warmups + 20 measured samples/session; all typed/restored document hashes and retained file hashes match, with clean unforced shutdown. Baseline `task114-baseline-1792726356249`: p50/p95 222.5/254.8 ms; candidate `task114-candidate-1792726415108`: 107.0/117.2 ms. Candidate p95 improves 54.0%, CPU p95 43.8%, RSS p95 12.1%, private RAM p95 16.6%. Candidate also improves against the original 279.7 ms baseline; neither report was overwritten.
- Root checked raw percentiles/counts and binary/source/actual fixture/output hashes (`artifacts/phase0/task114-audit-result.json`). Independent Luna source review found no blockers: table consumers preserve cached arrays through draft copying, offsets map recursively, parser refresh remains authoritative, and fenced scan pruning is valid for inline-only table cells. H1/H2 retain their stronger weights; all six levels meet the >=600 floor. No global typing-budget, non-Windows, or hosted-CI claim.
- Final Windows backend confirmation: all-target test log finishes with 120 top-level tests passed (plus the migration child-process test); fmt and final Clippy command exit 0 on Rust 1.99.0 MSVC. Evidence: `task114-backend-tests.log`, `task114-clippy-final.log`, `task114-clippy-exit.txt` under artifacts/phase0. Clippy was repeated only because the old terminal handle and its exit result were lost on usage interruption; native measurements were reused.

### Log
- 2026-10-22 — Created for direct implementation request for plan task 13. Corrected TASK-113 index to match its already-Done archive and commit; no implementation work from TASK-113 reopened.
- 2026-10-22 — User added active-heading marker reveal and Bold/Semi Bold typography for all heading levels. Initial CPU profile of a fixed 162,054-character mixed table/code document identifies table-model rebuilding and allocation as dominant scoped work; native baseline is running before production edits.
- 2026-10-22 — Frozen native baseline completed successfully in two fresh sessions before production edits. Implemented weak state/tree model reuse with source verification, nested offset mapping, draft alignment copying and fenced-scan pruning of table descendants. Added Write heading marker reveal and a shared Semi Bold floor for all six levels. Initial focused suite passed 44 tests; final gates include additional mapping/draft-mutation checks and browser coverage.
- 2026-10-23 — Resumed from the completed build after usage interruption, without rebuilding. Final frontend and 46 browser cases were already green; verified build/source provenance. Added parser-completeness assertions to the ignored native harness and preserved both baseline runs. Native comparison and independent source/raw-evidence audits pass; backend confirmation is running before commit.
- 2026-10-23 — Read completed primary backend log; fmt/Clippy final exit 0 confirmed. All required acceptance checks pass and independent source review has no blockers. Ready to commit; no source change since the measured candidate build.
- 2026-10-23 — Implemented and audited in commit `92581cf`; all acceptance checks passed, marked Done and archived. Unreleased changelog entries maintained in the existing ignored local changelog. No remote writes.
