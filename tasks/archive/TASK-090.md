## TASK-090 — Close unmatched formatting markers without duplicating

**State:** Done
**Current Step:** Completed

### Description
Implement the user's 2026-10-19 priority fix before TASK-016–020, Windows scope only.

### Scope
src/lib/cm-extensions/delimiter-pairs.ts; related task/changelog records.

### Requirements
- [x] Resolve the reported behavior while retaining existing intended interactions.

### Steps
- [x] Inspect current implementation and supplied screenshots where applicable → verify: identify cause.
- [x] Apply focused change → verify: source review and relevant static checks.
- [x] Commit separately with task ID → verify: record commit in task.md.

### Handoff
- Branch: main; source and focused regression changes committed locally.
- Next action: none for this task; current requested batch complete.
- Blockers: none within Windows scope.

### Verification
Four delimiter unit tests pass, including unmatched italic/bold/code/strike/quote markers, completed spans, literal code markers, list bullets and pair expansion. Related browser inline/table/caret regressions pass in the 28-test run.

### Log
- 2026-10-19 — Created from direct implementation request; authorized before the next five plan tasks (016–020).

- 2026-10-19 — User authorized regression tests; added unmatched/closed marker cases.

- 2026-10-19 — Refined marker scanning to ignore list bullets/code contents and match code runs by delimiter length; extended regression cases.

- 2026-10-19 — Final Windows verification recorded; source tree passed typecheck/lint/contracts/build, 291 frontend unit tests, 28 related browser tests and the full Rust all-target test run. No remote push or CI configuration change.
