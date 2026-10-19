## TASK-091 — Create Markdown files before adding collection entries

**State:** Done
**Current Step:** Completed

### Description
Implement the user's 2026-10-19 priority fix before TASK-016–020, Windows scope only.

### Scope
src/stores/collections.ts; document creation workflow; related task/changelog records.

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
Windows source review: missing Markdown picker paths go through exclusive create_file before metadata insertion; existing paths are read without overwriting and concurrent creation is re-read. Typecheck passed. No automated tests or native UI replay requested/run.

### Log
- 2026-10-19 — Created from direct implementation request; authorized before the next five plan tasks (016–020).
