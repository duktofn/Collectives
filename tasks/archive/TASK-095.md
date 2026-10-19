## TASK-095 — Replace application logo with supplied SVG

**State:** Done
**Current Step:** Completed

### Description
Implement the user's 2026-10-19 priority fix before TASK-016–020, Windows scope only.

### Scope
public; src assets; src-tauri/icons; app icon configuration; related task/changelog records.

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
Supplied SVG copied exactly to src/assets/logo.svg (favicon, title bar and welcome). Tauri icon generator produced Windows ICO and PNG assets; copied existing Windows icon paths only. PNG preview inspected, typecheck and Vite build passed (existing chunk-size warning remains). No tests run.

### Log
- 2026-10-19 — Created from direct implementation request; authorized before the next five plan tasks (016–020).
