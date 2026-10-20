## TASK-108 — Extract lifecycle and navigation workflows

**State:** Done
**Current Step:** Complete
**Source ID:** Phase B plan TASK-008

### Description
Implement the corresponding approved v1.4 plan task sequentially on Windows, preserving data, UI and recovery semantics.

### Scope
- `src/App.tsx`
- `src/workflows/AppLifecycleWorkflow.ts`
- `src/workflows/NavigationWorkflow.ts`
- `src/App.test.tsx`
- `src/App.phase5.test.tsx`
- Task ledger, codebase.md and decisions.md for the changed ownership boundaries.

### Requirements
- [x] Task-specific acceptance cases from the v1.4 plan pass.
- [x] Applicable Windows code, data, UX and performance gates have recorded evidence.
- [x] Scoped change reviewed; focused commit recorded before the next task starts.

### Steps
- [x] Step 1 — Trace existing ownership and establish baseline → verify: existing regressions and measured work identified.
- [x] Step 2 — Implement only the approved boundary/projection change → verify: focused regressions pass.
- [x] Step 3 — Run Windows gates and review diff → verify: exact results and limits recorded.

### Handoff
- Branch: `codex/phase-b-08-11`; initial base: `119ce0e`.
- Next action: none for TASK-108; proceed to TASK-109 after recording the implementation commit.
- Blockers: none.

### Verification
Windows, Rust 1.99.0 MSVC: frontend quality (298 tests, typecheck, lint, build), contracts, Rust fmt/Clippy/locked all-target tests and 126 + 5 browser tests pass. Isolated native release smoke passed two independent app sessions, startup, all 14 UI workloads and graceful cleanup (run phase0-20261020182204935-119ce0e-906c84f2). Smoke used one recorded sample per workload/session and is not a performance acceptance claim. Scoped diff reviewed: no JSX or keyboard shortcut changes; public close APIs retained. No hosted CI or other platform result is claimed.

### Log
- 2026-10-21 — Created from the user's direct implementation request for plan tasks 008–011. No remote writes authorized or performed.


- 2026-10-21 — Extracted lifecycle/navigation owners (DEC-016); App shrank by about 250 lines without JSX changes. Frontend quality passed 298 tests/typecheck/lint/build; contract and Windows Rust fmt/Clippy/all-target gates pass. Awaiting browser and isolated native release smoke.

