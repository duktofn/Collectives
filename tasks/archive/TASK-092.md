## TASK-092 — Fix selection of files inside collection folders

**State:** Done
**Current Step:** Completed

### Description
Implement the user's 2026-10-19 priority fix before TASK-016–020, Windows scope only.

### Scope
src/components sidebar tree; src/stores/ui.ts; related task/changelog records.

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
Source cause: CSS selected used readiness=ready, which stays true for previously opened files. It now uses actual selected entry and open path, matching aria-selected. Typecheck passed; no tests run.

### Log
- 2026-10-19 — Created from direct implementation request; authorized before the next five plan tasks (016–020).
