## TASK-110 — Incremental metadata projections

**State:** Done
**Current Step:** Complete
**Source ID:** Phase B plan TASK-010

### Description
Implement the corresponding approved v1.4 plan task sequentially on Windows, preserving data, UI and recovery semantics.

### Scope
- `src/features/collections/metadataCache.ts`
- `src/features/collections/metadataCache.test.ts`
- `src/stores/collections.ts`
- `src/stores/collections.phase3.test.ts`
- `src/stores/collections.newNoteAndMove.test.ts` (update the snapshot mock for the scoped reload API)
- `src/benchmarks/metadata-delta.bench.ts`
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
- Next action: inspect the allowlisted implementation for this task after its predecessor is committed.
- Blockers: none.

### Verification
Windows Rust 1.99.0 MSVC: frontend quality 313 tests/typecheck/lint/build, contracts, backend fmt/Clippy/all-target gates and 13 browser tests pass. 10k projection regression rebuilds only the changed leaf and its ancestor; malformed deltas, reparent/delete and queued reconciliation pass. Entry CRUD and validation are serialized; reload is scoped to one collection. Native metadata p95 2018.2 → 306.4 ms, 40 samples each from two independent fresh app-data sessions with five warmups/session, zero errors and graceful cleanup. Evidence: artifacts/phase0/phaseb-task110-{baseline-1792542154447,candidate-1792555840790}/performance.json. Algorithm proxy is 4.01x faster; it is not native latency.

### Log
- 2026-10-21 — Created from the user's direct implementation request for plan tasks 008–011. No remote writes authorized or performed.
