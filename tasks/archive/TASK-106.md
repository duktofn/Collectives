## TASK-106 — Create reproducible native Windows performance baseline

**State:** Done
**Current Step:** Complete
**Phase:** Refactor plan Phase A
**Source ID:** Attached plan TASK-007

### Description
Produce reproducible native Windows release-build performance evidence before Phase B optimization. Extend only the approved benchmark scripts, frontend benchmark files, scheduled/manual workflow, and add the native measurement script and baseline report.

### Scope
- `scripts/phase0/run-benchmarks.mjs`
- `scripts/phase0/generate-fixtures.mjs`
- `scripts/phase0/measure-native.ps1` (new)
- `src/benchmarks/phase0-frontend.bench.ts`
- `src/benchmarks/phase6-ui-latency.bench.ts`
- `.github/workflows/phase0-performance.yml`
- `docs/rebuild/main-native-performance-baseline.md` (new)
- `task.md` and `tasks/archive/TASK-106.md`

### Related
- `Collectives_Main_Architecture_Audit_Refactor_Plan_2026-10-19_v1.4(1).md` → Phase A / TASK-007 and DEC-PERF-01
- `docs/rebuild/phase-0-baseline.md`
- `decisions.md` → DEC-013 (Windows-only validation)

### Requirements
- [x] Fixed-seed fixture generation is reproducible and verified from independent output roots.
- [x] Native Windows release-build evidence covers cold/warm startup and whole Tauri/WebView2 process-tree memory/CPU plus all TASK-007 workloads.
- [x] At least two repeat sessions per native workload; retain raw samples and report p50/p95, RSS, CPU, errors, machine, and toolchain provenance.
- [x] Baseline report records DEC-PERF-01 budgets before any Phase B optimization and distinguishes measured behavior from synthetic/proxy coverage.
- [x] Native 50-cycle editor open/close proxy is explicitly labeled if a lightweight popup does not exist.
- [x] Applicable Windows quality gates pass; no headless-browser-only evidence is used to claim native completion.

### Steps
- [x] Step 1 — Audit current benchmark coverage and establish fixture/session design → verify: exact coverage gaps and native measurement capability are recorded.
- [x] Step 2 — Extend deterministic fixtures, benchmark workload schema, and Windows release workflow → verify: smoke/standard/large fixture pairs match exactly; benchmark suites run; workflow parses and targets Windows only.
- [x] Step 3 — Implement native Windows release measurement and workload capture → verify: each TASK-007 scenario records raw elapsed/RSS/CPU/error data with process cleanup evidence.
- [x] Step 4 — Run at least two independent native sessions and write the baseline report → verify: report includes p50/p95, machine/toolchain, fixed budgets, and limitations.
- [x] Step 5 — Run applicable Windows quality gates, review scoped diff, and close task → verify: scripts/gates pass; commit hash and evidence are recorded.

### Handoff
- Branch: `codex/phase-a-performance-baseline`; base commit: `30fa901`.
- Uncommitted files: pre-existing `.gitignore` edit (`.opencode`), unrelated and preserved; TASK-106 implementation committed as `f0eb16f`.
- Next action: none for TASK-106; GitHub CI follow-up remains in the separate Sol session and Phase A push is deferred until all Phase A tasks are complete.
- Blockers: none for local TASK-106. The separate hosted GitHub CI follow-up is not claimed as complete here.

### Verification
The initial audit found no native UI workloads or CPU metrics, and the workflow built debug on Ubuntu/Windows. The runner now builds Windows release binaries with unique Tauri identifiers, verifies app-data roots through the Tauri Path API, uses fresh WebView2 profiles, and collects process-tree RSS/CPU from a PowerShell monitor. The fixture generator adds deterministic 100 KiB/1 MiB typing inputs, 100/2,000-note search collections, watcher burst files, and chart/table/editor documents; the frontend bench suites include explicitly labeled algorithm/jsdom/synthetic proxies. The workflow is Windows-only. Smoke/standard/large independent fixture pairs match exactly (seed `phaseA-task007-v1`); content roots are recorded in the run artifacts. The trusted ZIP fixture initially exceeded its 64 KiB manifest cap and then failed its `assets/` namespace check; compact deterministic IDs and minified manifest now produce a 50,095-byte standard ZIP manifest and the native backend trusted-archive probe passes. `npm run check:ci-policy`, `npm run check:contracts`, targeted ESLint, and `node scripts/phase0/verify-quality.mjs frontend` pass (297 unit tests and production build). `measure-native.ps1 -Action self-check`, Node syntax checks, and workflow YAML parsing pass. One earlier startup probe found WebView2 child processes remaining briefly after Tauri exit; cleanup now drains the process tree gracefully before declaring failure. The installed Windows compiler is Rust 1.99.0 MSVC; repository CI pins Rust 1.97.0.

Final standard release run `phase0-20261020030924812-30fa901-6ebc5c8c` recorded two isolated Tauri release sessions, five cold and ten warm startup samples per session, thirteen UI workloads at five samples/session, and the 50-cycle proxy once/session. All native samples passed with zero operation errors and graceful process cleanup. Backend smoke and large coverage runs are `phase0-20261020032532283-30fa901-f7a99994` and `phase0-20261020032700251-30fa901-54adba81`. Independent fixture pairs matched exactly. The selected release evidence and required coverage matrix passed `verify-artifacts --require-release`. The report is `docs/rebuild/main-native-performance-baseline.md`.

Final Windows local gates passed on Windows 11 Pro: `npm run check:ci-policy`, `npm run check:contracts`, and `node scripts/phase0/verify-quality.mjs frontend` (TypeScript, ESLint, 297 frontend tests, production build). Rust fmt/clippy/all-target tests, the process monitor self-check, benchmark script syntax, targeted benchmark ESLint, and Windows-only workflow validation had passed earlier in this task. No application or Rust backend files were changed. `git diff --check` passed; the pre-existing `.gitignore` edit is excluded from TASK-106.

Implementation commit: `f0eb16f`.

### Reopened typing-measurement follow-up — 2026-10-20

The audit found the previous “typing” rows timed one whole-document Playwright `keyboard.insertText` operation, so their values were not per-key input-to-paint measurements. The old raw values and run remain retained as a bulk-insertion proxy only.

The regenerated smoke fixture now exposes separate preloaded 100 KiB and 1 MiB collections. The Windows release harness verifies each distinct fixture prefix, waits for fonts, five stable layout frames and 100 ms idle, then measures one printable `x` key through two animation frames. It verifies that the inserted key is visible after the paint barrier and records five warmups plus 20 samples per size in each of two independent release sessions.

Corrected standard run `phase0-20261020123504178-5241dc7-d67f3473` passed with 40 valid samples per size and zero operation errors. Combined p50/p95: 100 KiB 56.0/75.7 ms; 1 MiB 139.7/267.3 ms. The 1 MiB p95 remains above the 120 ms DEC-PERF-01 target before Phase B. Regenerated smoke/large runs `phase0-20261020125514177-5241dc7-b6abf04f` and `phase0-20261020125712051-5241dc7-53621c2f` passed; `verify-artifacts --require-release`, targeted ESLint, Node syntax checks, `npm run check:ci-policy`, and `git diff --check` passed. Rust 1.99.0 MSVC on Windows 11 Pro. No Linux/macOS result is claimed.

Typing-method implementation and report commit: `bb75a6f`.

### Log
- 2026-10-20 — Created for Phase A / attached plan TASK-007 after verifying Windows-only scope and the existing benchmark runner gaps.
- 2026-10-20 — Step 1 complete: audited workload and fixture gaps; confirmed CDP is available and identified stale production-profile recovery as requiring a dedicated measurement identifier.
- 2026-10-20 — Step 2 complete: added deterministic native workload fixtures, explicit synthetic benchmark coverage, process-tree collector, and Windows-only release workflow. Frontend, contract, policy, fixture reproducibility, and trusted ZIP fixture gates pass.
- 2026-10-20 — Step 3 started: native session runs are exercising release builds, WebView2 startup, app-data isolation, and the full UI workload matrix; early harness issues are being corrected within the allowed scripts/fixture scope.
- 2026-10-20 — Native smoke run completed two independent release sessions with all 14 requested UI/backend workloads, zero measured errors, process cleanup, and valid raw artifacts. Corrected CodeMirror's virtualized DOM assertion and changed editor close/reopen proxy to switch through an empty collection; added a settled-idle window for the 50-cycle RAM delta.
- 2026-10-20 — Follow-up: process monitor now computes CPU deltas per PID across the sample window; repeat sessions use separate Tauri identifiers and app-data profiles so an edited fixture or recovery journal cannot contaminate the next session.
- 2026-10-20 — Step 3 complete: final standard Windows release run `phase0-20261020030924812-30fa901-6ebc5c8c` passed with two independent native sessions, 5 cold / 10 warm startups per session, all 14 UI workloads, zero errors, and verified graceful process-tree cleanup. Root artifact validation passed; selected-matrix verification identified the workflow's smoke and large backend coverage jobs still to run.
- 2026-10-20 — Step 4 complete: smoke and large backend coverage runs passed, independent fixture pairs matched, selected release evidence and coverage validation passed, and the baseline report was written. Step 5 started for final gates and scoped review.
- 2026-10-20 — Final Windows local gates passed and the scoped diff was reviewed; no out-of-scope TASK-106 files were found. Commit and archive remain.
- 2026-10-20 — TASK-106 completed; implementation commit `f0eb16f`.
