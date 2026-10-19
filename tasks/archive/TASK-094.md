## TASK-094 — Prevent list and table mutations in Read mode

**State:** Done
**Current Step:** Completed

### Description
Implement the user's 2026-10-19 priority fix before TASK-016–020, Windows scope only.

### Scope
src/lib/cm-extensions; src/components/editor/Editor.tsx; related task/changelog records.

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
Typecheck passed on Windows. Source review: Read Enter is consumed before Markdown list continuation; user document transactions are rejected in Read mode. Table equality includes readOnly so old editable DOM is rebuilt on mode switch; row/column changes check current view readOnly. No tests added/run.

### Log
- 2026-10-19 — Created from direct implementation request; authorized before the next five plan tasks (016–020).

- 2026-10-19 — Added browser regression for Write→Read→Write table/list transitions after test authorization.
