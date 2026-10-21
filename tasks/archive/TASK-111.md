## TASK-111 — Stable watcher subscriptions

**State:** Done
**Current Step:** Completed Windows regression and native performance gates
**Source ID:** Phase B plan TASK-011

### Description
Implement the corresponding approved v1.4 plan task sequentially on Windows, preserving data, UI and recovery semantics.

### Scope
- `src/stores/collections.ts`
- `src/features/collections/metadataCache.ts` and `.test.ts` (cursor gap/replay validation)
- `src/components/tree/FolderRefNode.tsx` (route traced legacy and v2 hints through the same reload scheduler)
- `src/features/filesystem/folderRefFeed.ts`
- `src/features/filesystem/folderRefReadiness.ts`
- `src-tauri/src/fs_layer/watcher.rs`
- `src-tauri/build.rs` (Windows test harness common-controls manifest required by WatchManager regression)
- `src/stores/collections.phase3.test.ts`
- `src/features/filesystem/folderRefFeed.test.ts`
- `src-tauri/tests/phase3_watcher.rs`
- `src-tauri/tests/phase6_watcher_stress.rs`
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
- Implementation commit: `0b0a8fa`; no source changes remain uncommitted.
- Next action: none in TASK-111. TASK-108–112 are complete; no remote writes authorized.
- Blockers: none.

### Verification
- Frontend: typecheck/lint/build and 321 tests pass. After TASK-112, all 321 pass with two workers; canonical default-worker import timeouts are recorded in TASK-112, not hidden. Browser coverage: all 131 distinct cases pass with the documented isolated theme rerun and Phase 6 run. Assertions and timeouts unchanged.
- Backend: formatting/Clippy/all-targets and 112 tests pass on Rust 1.99.0 MSVC (`task111-backend-final.log`). Windows unit harness links the generated application resource to supply common-controls v6.
- Final native: 2 fresh app-data/process sessions, 5 warmups + 20 measured samples per workload/session; 40 samples each, zero errors. Both remove a physically deleted file through the UI and verify its absence in canonical metadata. Both exit 0 without forced cleanup or remaining PIDs.
- Metadata rename at 10,000 entries: p95 178.8 ms versus 306.4 ms baseline. Watcher publication-to-visible at 1,000 children: p95 1104.2 ms versus 1501.6 ms. CPU p95 ratios 0.45/0.34; peak-RSS p95 ratios 1.02/0.64. Latency regression limit 1.15 passes.
- Evidence: `artifacts/phase0/phaseb-task111-resumed-final-1792597149804/{performance,acceptance}.json`. Setup preserves installed watch specs during snapshot reads; measured functions match the baseline collector. First completed session was resumed from its immutable checkpoint after an export-name collision; binary/collector hashes and sample/cleanup completeness were verified before reuse. No fabricated or edited samples.
- Earlier apparent missing probe was disproved by read-only SQLite inspection: compatibility JSON does not include direct v2 mutations. Failed setup artifacts remain retained. No remote writes or user app-data changes.

### Log
- 2026-10-21 — Created from the user's direct implementation request for plan tasks 008–011. No remote writes authorized or performed.
- 2026-10-21 — Paused after the running focused checks finished, as requested. TASK-108–110 remain completed; resume TASK-111 before investigating dev startup in TASK-112.
- 2026-10-21 — Checkpoint `0b0a8fa`: 321 frontend and 112 Windows backend tests pass; final native/performance and cold browser gates remain pending. Continue TASK-112 to unblock the latter.
- 2026-10-21 — TASK-112 restored dev startup; final native regression and performance gates passed with two complete independent sessions. Task complete.
