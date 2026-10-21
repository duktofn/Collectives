## TASK-109 — Own document session coordination

**State:** Done
**Current Step:** Complete
**Source ID:** Phase B plan TASK-009

### Description
Implement the corresponding approved v1.4 plan task sequentially on Windows, preserving data, UI and recovery semantics.

### Scope
- `src/stores/editor.ts`
- `src/components/editor/Editor.tsx`
- `src/features/editor/documentSession.ts`
- `src/features/editor/documentSession.test.ts`
- `src/stores/editor.phase1.test.ts`
- `src/components/editor/Editor.transitions.test.tsx`
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
- Branch: `codex/phase-b-08-11`; original main base: `119ce0e`; predecessor closure: `39a3216`.
- TASK-108 (plan 008) is Done: implementation `3dbe5e4`, evidence/closure `39a3216`.
- TASK-109 (plan 009) is implemented and verified by local code/backend/browser gates, but NOT Done: native acceptance and the additional metadata benchmark setup are unresolved.
- Paused implementation commit: `dc4e3c3`. Uncommitted implementation files: none. No push or PR was made.
- Next action: inspect the paused commit/diff and diagnostic evidence; isolate the native metadata probe independently of document-session code before repeating a full release benchmark. Finish TASK-109 verification/closure before changing TASK-110 source.
- Native evidence helpers and logs are ignored local artifacts: `artifacts/phase0/phase-b-native-runner.mjs`, `phase-b-diagnostic.mjs`, `phase-b-diagnostic-ui.mjs`, `phase-b-diagnostic-stable.mjs`, `task109-native.log`, `task109-focused.log`, `task109-frontend.log`, `task109-contracts.log`, `task109-backend.log`, `task109-clippy.log`, and `task109-browser.log`.
- Fixed-seed input roots: `%TEMP%/collectives-phaseb-08-11-fixtures/{smoke,standard,large}`. Failed run profiles have `.phase0-owner` markers under `%APPDATA%/com.collectives.phase0.*`; they are isolated test data and have NOT been deleted, moved, reset or repaired. Never touch the production profile.
- Important failed run: `phase0-20261020184701452-39a3216-49be03cc` (backend mutation setup succeeded after a CAS retry, UI tree count timed out; graceful exit 0 and no remaining processes). The final diagnostic against the same owned fixture exited 101 before WebView startup; its cause has not been established. Do not reuse that profile as clean performance evidence.
- Blockers / limits: no passing complete TASK-109 native run or accepted pre-optimization metadata baseline. TASK-110 and TASK-111 remain Not Started. The user explicitly resumed on 2026-10-21. The earlier pause no longer applies.

### Verification
Windows, Rust 1.99.0 MSVC: 32 focused session/store/view tests passed; full frontend quality passed 302 tests, typecheck, lint and production build. Contracts/boundaries, Rust fmt, Clippy with warnings denied and locked all-target tests passed. Twenty focused browser tests passed (missing file, inline formatting, behavior and selection/history/table). These checks validate the extracted document-session factory and facade, including independent readers/queues, stale read rejection, failed-save retention and A→B undo isolation. No Linux/macOS or hosted CI result is claimed.

Native validation is NOT complete. Extended benchmark attempts failed during setup and are not acceptance evidence. Observed issues: existing Rust operation DTO fields deserialize as snake_case while the TS contract declares camelCase; native metadata revisions changed during asynchronous collection validation; the probe's added group did not remain visible, and a later diagnostic read returned 10,000 entries. `application/services.rs::validate_entries` reads a collection before async filesystem checks and later saves that whole collection, so overwriting concurrent metadata is a suspected pre-existing race (this Rust file is unchanged from the base). No fix was applied or accepted for these issues. A stable-validation barrier was added only to an ignored diagnostic helper; its final reused-profile attempt exited 101 at startup, so that helper adjustment is unverified.

### Log
- 2026-10-21 — Created from the user's direct implementation request for plan tasks 008–011. No remote writes authorized or performed.


- 2026-10-21 — Started after TASK-108 implementation 3dbe5e4 and verification were committed. Session coordination will move behind an injected selection port; persistence and view-state semantics remain unchanged.


- 2026-10-21 — Moved the existing state machine unchanged behind createDocumentSession and an injected selection port (DEC-017). New independent-session/delayed-read/save-failure/undo-boundary regressions pass; full frontend quality passes 302 tests; contracts/backend gates and 20 focused browser cases pass. Native validation is in progress. An evidence-only runner extension uses the existing versioned mutation API to measure 20 metadata renames plus five warmups/session; an early invocation using the legacy no-event API was interrupted and is not acceptance evidence.


- 2026-10-21 — The first metadata probe was rejected by native deserialization: operation DTO fields use snake_case although the existing TS contract declares camelCase. This pre-existing contract mismatch is outside tasks 008–011; no application/contract change was made. The evidence helper now uses the actual native DTO field names. The rejected run is not acceptance evidence and native process cleanup succeeded.


- 2026-10-21 — User explicitly requested saving current state and pausing. TASK-109 is Paused, native verification unfinished; TASK-110/111 have no source changes. No matching task-owned validation runner was still active at the pause audit. Coherent verified code will be committed without marking the task Done.

- 2026-10-21 — Saved the paused implementation as `dc4e3c3`. Ledger records completed local checks and unresolved native evidence; user-requested pause is in effect.


- 2026-10-21 — Resumed at explicit user direction from clean checkpoint faa272a. Separating the existing native document-session smoke from the experimental metadata baseline. Prior failed profiles will remain untouched.


- 2026-10-21 — Final clean native smoke passed two fresh release sessions and all 14 standard UI workloads: phase0-20261020230855978-faa272a-400b2b46, graceful exit 0 and no residual processes. This supersedes the pending document-session native gate; the separate metadata probe failures remain diagnostic history. TASK-109 complete; implementation dc4e3c3.
