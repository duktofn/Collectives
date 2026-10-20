## TASK-100 — Fix Windows theme picker alignment gate

**State:** Done
**Current Step:** Complete — combined Phase A hosted browser gate passed
**Phase:** Prerequisite for Phase A / TASK-099
**Source ID:** Owner-approved follow-up to unblock the existing Windows browser gate

### Description
Resolve the reproducible Windows theme-picker chevron alignment failure while preserving the keyboard, dismissal, and small-window browser coverage. Fix the component alignment if the rendered geometry is wrong; adjust the assertion only if evidence shows the expected layout is correct and the current threshold is over-constrained.

### Scope
- `e2e/editor-theme-library.spec.ts`
- `src/components/theme/ThemePicker.css`

### Related
- `task.md` → TASK-099 (fresh Windows workflow gate)
- `Collectives_Main_Architecture_Audit_Refactor_Plan_2026-10-19_v1.4(1).md` → Phase A / TASK-002 gate

### Requirements
- [x] Explain and correct the 1.655 px Windows chevron-center mismatch or justify a stable pixel tolerance from measured layout.
- [x] Keep the keyboard, dismissal, and 720×600 viewport checks meaningful.
- [x] The affected Playwright spec and full Windows browser suite pass.
- [x] Applicable local G-CODE gates pass on Windows; hosted CI rerun is still pending.

### Steps
- [x] Step 1 — Inspect trigger, SVG box, computed styles and browser metrics → verify: the CSS positions the icon at the trigger center; separate Playwright `boundingBox()` calls could observe different scroll positions.
- [x] Step 2 — Measure both elements in one browser evaluation after a single scroll → verify: the original <1 px and >=12 px thresholds pass 10 repeated runs.
- [x] Step 3 — Run Windows browser and applicable quality gates → verify: full browser suite and task checks pass; diff review has no unrelated files.

- [x] Step 4 — Verify the combined Phase A hosted browser job after authorized batch push → verify: the current branch browser check succeeds.

### Handoff
- Branch: `codex/phase-a-performance-baseline`; original E2E fix: `66610c4`; hosted-tested PR head: `32a5d20`.
- Uncommitted files: unrelated `.gitignore` edit preserved.
- Next action: none for TASK-100. The combined Phase A browser job passed after separate TASK-107 fixed its newly observed table-test timing issue.
- Blockers: none for this theme-picker fix. TASK-099 still tracks whole-workflow and remote-protection evidence; no merge performed.

### Verification
Windows Node 20.19.0 / Git for Windows 2.56.0: focused Playwright spec repeated 10 times (20 cases): 20/20 pass; full `npm run test:e2e`: 126 browser tests + 5 Phase 6 tests pass. Frontend typecheck, lint, 291 unit tests and production build pass. `npm run check:contracts` passes. Rust 1.99.0 Windows fmt, clippy and locked all-target tests pass. Second-agent review: no findings.

Hosted PR #5 run 39276809449 is still in progress. Its browser job passed; backend passed; frontend had one existing `code-block-pointer.test.ts` failure (expected 2 lines, received 0), which passes in the focused local run and full frontend gate. Phase0-smoke remains running.

### Log
- 2026-10-19 — Created with owner authorization to unblock TASK-099 without expanding TASK-099’s allowlist.

- TASK-089 Done: Windows-only scope. TASK-086 Paused by user; TASK-014 Paused awaiting genuine main CI history. TASK-014 proof commit: `31cd13f`.

### Latest handoff — 2026-10-19

Requested batch complete on Windows: priority TASK-090/091/092/094/095 Done, folder-as-group TASK-093 Cancelled, next five TASK-016–020 Done. TASK-014 and TASK-086 remain Paused. No remote pushes, merges or CI changes in that batch. Tracked working tree clean. Next plan task is TASK-021; wait for user's next request.

Verification: Node 24.20.0, Rust 1.99.0 on Windows. Typecheck/lint/contracts/build pass; 291 frontend unit tests and 28 related browser tests pass; full Rust all-target test run passes. Existing Vite chunk-size warning and Playwright environment-color warning remain. Tests use isolated files/mocked IPC; native dialog interaction and installed icon cache were not replayed.
- 2026-10-19 — Applied branch protection and read back the exact four Windows checks and flags.
- 2026-10-19 — Negative probe PR #4 was blocked by the required frontend status (`mergeable_state=blocked`), then closed unmerged; temporary branch deleted.
- 2026-10-19 — Existing theme-picker E2E alignment assertion failed identically locally and in two hosted attempts; paused before changing out-of-allowlist files.
- 2026-10-19 — Tracking commit `af6ceaf` records the applied protection and the remaining CI gate.
- 2026-10-19 — Owner approved a focused TASK-100 for the out-of-allowlist browser assertion; TASK-099 remains paused until the gate passes.
- 2026-10-19 — Local focused spec passed 10 repeats; full browser, frontend, contract and Rust Windows gates passed; review found no issues. Hosted CI is still pending.
- 2026-10-19 — User narrowed active work to Git pre-push hook files; closed PR #5 unmerged and deleted its branch. Task paused with local fix preserved in commit `8e610c7`.

- 2026-10-20 — Resumed by owner after TASK-106 completed at 91a442e. Verified saved commit 8e610c7 changes only the unchanged theme-picker measurement block; original centering/right-gap thresholds and interaction coverage remain intact. Current hosted diagnosis: run 39278459779 browser failed at 1.65570068359375 px; saved fix run 39276809449 browser passed. Latest combined HEAD has no hosted run; remote writes remain deferred.

- 2026-10-20 — Local Windows verification passed: focused spec repeat-each=10 (20/20), npm run test:e2e (126 main + 5 Phase 6), canonical frontend gate (typecheck/lint/297 tests/build), contracts, CI policy, hook fixtures and canonical backend fmt/Clippy/locked all-target tests. Node 24.20.0; rustc 1.99.0 x86_64-pc-windows-msvc. Quality evidence: artifacts/phase0/quality-logs/quality-frontend-20261020033936261.json and quality-backend-20261020033942818.json. G-REVIEW: no actionable findings, patch exactly matches 8e610c7. Paused only for combined hosted CI; no push/merge, no product/CSS/backend/benchmark changes.

- 2026-10-20 — Verified local checkpoint commit: `66610c4` (TASK-100); combined hosted browser evidence remains pending.

- 2026-10-20 — Owner clarified the pictured target is the full CI workflow, not only the hook PR frontend. Exact duration match identifies run 39278459779 attempt 1 at 7ca559e: frontend 214 s (3m34s), browser 228 s (3m48s). GitHub job/check readback plus downloaded logs confirm backend job 118148346008 SUCCESS (Rust 1.97.0 Windows MSVC fmt/Clippy/all-target tests; quality status pass), phase0-smoke job 118148346111 SUCCESS (fixtures/harness/schema pass), browser job 118148346083 FAILURE (125 passed, 1 failed; theme picker 1.65570068359375 px against <1 at e2e/editor-theme-library.spec.ts:70). There are no backend/smoke failure roots to fix in this matching run.
- 2026-10-20 — Retrieved actual check annotations via Code Review connector: backend and smoke each have one WARNING for Node 20 action runtime deprecation (checkout/setup-node v4; smoke also upload-artifact v4); browser has that WARNING plus FAILURE Process completed with exit code 1. Annotation counts are not failed-job counts. No action-version upgrade or Rust/backend/benchmark change is justified by these warnings.
- 2026-10-20 — Confirmed the current E2E spec still exactly matches saved fix 8e610c7 (empty git diff); local integration is 66610c4. Existing same-spec Windows evidence remains 20 focused repeats/cases and 126+5 full browser cases passing, with original <1 px / >=12 px thresholds unchanged. Subsequent changes were hook scripts and task records only, so no additional code edits or redundant test rerun are needed. To obtain a green hosted workflow for the fixed combined revision, owner must authorize the deferred Phase A batch push and PR creation/update targeting main; rerunning 39278459779 alone reuses the unfixed remote 7ca559e. Stop before all remote writes. TASK-106 files and unrelated .gitignore remain untouched.

- 2026-10-20 — Combined Phase A hosted browser requirement met: PR #6 head 32a5d20, run 39383835890, browser job 118498860935 SUCCESS (126 main + 5 Phase 6 cases). Frontend and backend jobs also succeeded. Theme measurement thresholds remain <1 px and >=12 px; no product/CSS change. Separate TASK-107 fixed the freshly observed table-test forced-click timing race. Original theme fix 66610c4 and local evidence 777fa84 remain intact. All TASK-100 requirements and steps complete; Done and archived. Smoke job is still pending at this browser-specific closure; no whole-workflow claim yet.
