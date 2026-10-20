## TASK-107 — Wait for restored table controls before disabled-button probe

**State:** Done
**Current Step:** Complete — fresh hosted Windows browser gate passed
**Phase:** Phase A CI follow-up

### Description
Fix only the fresh Windows browser gate in PR #6 run 39382427686. The test force-clicks the last disabled delete-column button before the replacement table restores its control visibility; preserve all row/column deletion, minimum-one-column, disabled-button and no-op assertions.

### Scope
- `e2e/editor-table-interaction.spec.ts`
- `task.md` and `tasks/archive/TASK-107.md`

### Related
- PR #6 / run 39382427686 / browser job 118494341000
- `src/lib/cm-extensions/table-widget.ts` → `replaceTable` restores focused cell and active controls in requestAnimationFrame (read-only evidence)

### Requirements
- [x] Establish the fresh hosted failure and its visibility/actionability timing cause.
- [x] Preserve all existing deletion, disabled-button and minimum-one-column assertions without retries/skips/tolerance changes.
- [x] Focused repeated cases, full Windows browser suite, frontend/contracts/policy and review pass.
- [x] Fresh PR browser CI validates the fix; report remote-update dependency honestly if another push is outside the single batch authorization.

### Steps
- [x] Step 1 — Inspect hosted log and control restoration, reproduce locally where possible → verify: exact failed action and async boundary recorded.
- [x] Step 2 — Wait for the intended active control before the disabled native-click probe → verify: focused repetitions pass; no application change.
- [x] Step 3 — Validate Windows gates and review scoped diff → verify: full browser/frontend/contracts/policy checks pass; unchanged backend evidence reused from current green job.
- [x] Step 4 — Commit verified fix and obtain hosted result if authorized → verify: exact commit/job evidence; no merge.

### Handoff
- Branch: `codex/phase-a-performance-baseline`; original fix commit: `02da522`; hosted PR head: `32a5d20`.
- Uncommitted files: unrelated `.gitignore` edit preserved.
- Next action: none for TASK-107. Fresh hosted browser, frontend and backend jobs passed; whole-workflow smoke status is tracked separately under TASK-099 until complete.
- Blockers: none for this browser-test fix. No merge authorized or performed.

### Verification
Fresh hosted run: frontend and backend succeeded, browser 125/126 failed only at `e2e/editor-table-interaction.spec.ts:164` with `locator.click: Element is not visible`, resolving a disabled Delete column 1 button. The old theme-picker assertion passed. `replaceTable` renders new controls hidden and restores focus/active visibility in the next animation frame; `force: true` skips the wait for ordinary actionability. Smoke job remains running.

### Log
- 2026-10-20 — Created before source edits after fresh PR #6 job 118494341000 proved the failure; scope is the single existing E2E spec, with no Rust/application/benchmark changes.


- 2026-10-20 — Step 1 complete: downloaded fresh hosted browser log; the failing force-click resolves an already disabled, still-hidden button at line 164. Source shows controls start hidden and replaceTable restores active visibility in requestAnimationFrame; forced click bypasses actionability waiting. Original exact case passed 20 local repetitions (1.4m), so no deterministic local reproduction is claimed. Add an auto-retrying visibility assertion before the existing forced disabled native-click probe; preserve all assertions.

- 2026-10-20 — One-line fix complete: await expect(deleteLastColumn.nth(1)).toBeVisible() before the existing forced disabled click. Patched focused case repeated 20 times: 20/20 pass; full npm run test:e2e: 126 main + 5 Phase 6 cases pass; frontend typecheck/lint/297 unit tests/build, contracts and CI policy pass. Frontend quality evidence: artifacts/phase0/quality-logs/quality-frontend-20261020065509575.json. G-REVIEW: no actionable findings. No new backend run was needed for this spec-only change; fresh hosted fd9c171 backend job 118494340963 passed Rust 1.97.0 Windows MSVC; phase0-smoke job 118494340965 also succeeded. Local toolchain Node 24.20.0 / Rust 1.99.0 Windows MSVC. No application, Rust, workflow, benchmark or .gitignore edits.
- 2026-10-20 — User instructed a single evidence-based attempt, then a gate audit/report and stop if hosted CI remains red. The original PR run 39382427686 completed with frontend/backend/smoke SUCCESS and browser FAILURE at the force-click. No claim this fresh local fix has passed hosted CI: it is absent from remote fd9c171. Commit the verified fix; pause before a follow-up push beyond the explicitly authorized single batch push. All original assertions remain; no retry/skip/sleep/tolerance change.

- 2026-10-20 — Verified local fix committed as `02da522` (TASK-107); PR #6 remains at fd9c171 until a follow-up push is authorized. Paused with all local checks passed and hosted verification pending.

- 2026-10-20 — User explicitly authorized the follow-up push and one final validation attempt. Normal pre-push typecheck/lint passed; pushed fix 02da522 plus checkpoint record 32a5d20 to existing PR #6. Run 39383835890 tests head 32a5d20a28e3908fd2db757f872dd062b4f8d3db. Browser job 118498860935 SUCCESS (126 main tests + 5 Phase 6 tests); frontend job 118498860705 SUCCESS (297 unit tests, hook/policy/frontend/contracts gates); backend job 118498860914 SUCCESS with Rust 1.97.0 Windows MSVC. No second code fix, rerun loop, or gate weakening occurred. All TASK-107 requirements met; Done and archived. Full workflow smoke job is still running at this documentation checkpoint; no whole-workflow success claim yet.
