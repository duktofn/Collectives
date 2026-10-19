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
- Branch: main; base: b43e4cd.
- Next action: inspect scope and implement this request in priority order.
- Blockers: none.

### Verification
Source reviewed: unmatched marker runs now insert only the typed closer; completed runs retain pairing, overtyping and empty-pair expansion. TypeScript check passed on Windows; no tests added/run.

### Log
- 2026-10-19 — Created from direct implementation request; authorized before the next five plan tasks (016–020).
