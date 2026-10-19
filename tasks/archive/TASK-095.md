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
- Branch: main; source and focused regression changes committed locally.
- Next action: none for this task; current requested batch complete.
- Blockers: none within Windows scope.

### Verification
Supplied SVG copied to favicon, title bar and welcome. Windows ICO/PNG generated with Tauri, 128px preview inspected. Final typecheck/build pass; native installed-app icon cache was not exercised.

### Log
- 2026-10-19 — Created from direct implementation request; authorized before the next five plan tasks (016–020).

- 2026-10-19 — Final Windows verification recorded; source tree passed typecheck/lint/contracts/build, 291 frontend unit tests, 28 related browser tests and the full Rust all-target test run. No remote push or CI configuration change.
