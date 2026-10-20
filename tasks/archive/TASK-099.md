## TASK-099 — Enforce main branch protection for Windows CI

**State:** Done
**Current Step:** Complete — all requirements verified
**Phase:** Refactor plan Phase A
**Source ID:** Attached plan TASK-002

### Description
Ensure `main` requires the canonical Windows CI jobs, stays up to date with its base, blocks force pushes and deletion, and actually enforces the checked-in policy.

### Scope
- `.github/main-branch-protection.json`
- `scripts/ci/verify-policy.mjs`
- `.github/workflows/ci.yml`
- GitHub repository `duktofn/Collectives`: branch protection for `main`
- Task ledger and CI evidence

### Related
- `Collectives_Main_Architecture_Audit_Refactor_Plan_2026-10-19_v1.4(1).md` → Phase A / TASK-002
- `task.md` → TASK-099

### Requirements
- [x] Historical 2026-10-19 application/readback matched the checked-in policy: strict, four Windows checks from GitHub Actions, administrators enforced, no force pushes or deletions.
- [x] A deliberately failing PR cannot merge under the effective rule.
- [x] A fresh `main` workflow is green after the protection is set.
- [x] `npm run check:ci-policy` passes on Windows.
- [x] The completed TASK-104 and TASK-106 audit follow-ups pass all four canonical Windows checks on their exact PR head and a fresh `main` run after normal merge.
- [x] Current detailed protection readback reconfirms strict=true, enforce_admins=true, the exact four Windows required contexts, allow_force_pushes=false, and allow_deletions=false.

### Steps
- [x] Step 1 — Read current policy, workflow, and repository protection → verify: recorded unprotected `main` before the change.
- [x] Step 2 — Apply only the approved Windows rule and read it back → verify: API reports exact four contexts and flags.
- [x] Step 3 — Run the failed-PR probe and policy gate → verify: PR #4 frontend check failed, GitHub reported `mergeable_state=blocked`, PR closed unmerged and probe branch deleted.
- [x] Step 4 — Obtain a green fresh workflow after all required checks pass → verify: all four status contexts succeed.

- [x] Step 5 — Reconfirm the remaining detailed protection flags without changing settings → verify: live GitHub CLI readback matches the required policy; no settings changed.
- [x] Step 6 — Publish the completed TASK-104/TASK-106 follow-ups in one PR → verify: all four canonical Windows jobs pass on the exact PR head.
- [x] Step 7 — Merge normally after the required PR checks pass and verify a fresh `main` run → verify: all four required jobs succeed on the merge commit.

### Handoff
- Branch: `codex/phase-a-close-task-099`; base `main`: `ccdeff5936c971b85edc38629d0a1d98e437781f`.
- Uncommitted files: none after the task closure commit.
- Next action: none — TASK-099 is complete.
- Blockers: none.

### Verification
Checked-in policy/workflow align on four Windows checks: `frontend`, `browser`, `phase0-smoke`, and `backend (windows-latest)`, all from app 15368. Applied protection through the admin-authorized GitHub credential and read it back: strict=true, enforce_admins=true, exactly those four contexts, force pushes=false, deletions=false.

Negative probe PR #4 failed the required frontend job; GitHub API reported `mergeable_state=blocked`. PR #4 was closed unmerged and its temporary remote branch deleted. `npm run check:ci-policy` passes. PR #3 frontend, backend and smoke jobs pass; its browser job failed twice on `e2e/editor-theme-library.spec.ts:70`. Local Windows reproduction fails at the same assertion (1.6553 px vs <1 px). The unrelated E2E file is outside this task's allowlist, so a fresh all-green workflow remains outstanding.

Earlier CI and API notes below are historical; the final 2026-10-21 readback and CI evidence supersede their pending or blocked state:
- Final PR #6 head `34c9b9c36d2a219c0b8697b15252c810a6fe3682`: run [39385833931](https://github.com/duktofn/Collectives/actions/runs/39385833931) SUCCESS. Jobs frontend `118505336232`, browser `118505336560`, backend Windows `118505336511`, and smoke `118505336474` all SUCCESS.
- Normal merge of PR #6, guarded by that exact expected head, succeeded as `f6042394fbec4c114ed9c5a8c8fd302429b92cbb`; no admin override or protection mutation. PR readback is closed/merged.
- Fresh `main` push run [39417711656](https://github.com/duktofn/Collectives/actions/runs/39417711656) at that merge commit completed SUCCESS. Jobs frontend `118610679389` (297 unit tests plus hook/policy/typecheck/lint/build/contracts), browser `118610679353` (126 main + 5 Phase 6), backend Windows `118610679687` (fmt/Clippy/locked all-target tests), smoke `118610679069` (fixtures/harness/schema; 4 JSON artifacts) all SUCCESS. Hosted compiler: Rust 1.97.0 x86_64-pc-windows-msvc. No Linux/macOS result is claimed.
- Current public branch summary: `protected=true`, protection enabled, enforcement_level `everyone`, exact contexts `frontend`, `browser`, `phase0-smoke`, `backend (windows-latest)`, each GitHub Actions app `15368`. Current detailed protection endpoint: HTTP 403 `Resource not accessible by integration`; strict/up-to-date, administrator, force-push and deletion flags are not independently reverified now. Their earlier successful application/readback remains historical evidence only.
- PR #7 `codex/phase-a-audit-fixes` merged normally at `48fb04afa3640009ed4ad9517d1d516722ff5fe2`. Its exact head run `39430267861` passed frontend, browser, backend (windows-latest), and phase0-smoke. Fresh `main` push run `39462215074` at the merge commit also passed all four jobs: frontend `118764321571`, browser `118764321269`, backend `118764321037`, and phase0-smoke `118764321432`.
- 2026-10-21 final readback via authenticated GitHub CLI: `strict=true`, exact contexts `frontend`, `browser`, `phase0-smoke`, `backend (windows-latest)` from app 15368, `enforce_admins=true`, `allow_force_pushes=false`, and `allow_deletions=false`. No branch-protection settings were changed.
- Latest fresh `main` run [39465424016](https://github.com/duktofn/Collectives/actions/runs/39465424016) at merge commit `ccdeff5936c971b85edc38629d0a1d98e437781f` completed SUCCESS: frontend `118775438785`, browser `118775438528`, backend (windows-latest) `118775438185`, and phase0-smoke `118775438474` all succeeded. PR #8 head run `39464024745` also passed all four jobs.
### Log
- 2026-10-19 — Started Phase A / plan TASK-002 after TASK-098 passed Windows frontend CI and review.







- 2026-10-20 — Read-only primary-source diagnosis: latest run 39278459779 completed (not queued): frontend/backend/phase0-smoke succeeded; browser failed only at editor-theme-library.spec.ts:70 (1.65570068359375 px vs <1). Saved TASK-100 run 39276809449 browser/backend/smoke succeeded, frontend failed at code-block-pointer.test.ts:46 (2 expected, 0 received); the subsequent 39278459779 frontend passed all 291 tests. No hosted run exists for original Phase A base 30fa901. Actual branch protection read was denied by integration (403), so historical applied-policy evidence remains historical.
- 2026-10-20 — Local prerequisite gates restored and checked on the combined branch: TASK-100 implementation 66610c4 / evidence 777fa84; TASK-101 integration 02acf03 / evidence 68e21e5 includes exact TASK-098 prerequisites. All local frontend/contract/hook/policy, 20 repeated focused cases, full 126+5 browser cases and Windows Rust 1.99.0 MSVC backend gates pass. TASK-106 files and unrelated .gitignore edit preserved. Remain Paused until authorized batch remote writes and fresh required CI/main evidence; no workflow, protection, or gate changes.

- 2026-10-20 — CI diagnosis and current handoff recorded in commit `a521371` (TASK-099). No remote writes performed.

- 2026-10-20 — User authorized the Phase A batch push: fd9c171 was pushed normally and PR #6 opened against main. Fresh run 39382427686 passed frontend/backend/smoke; browser found a different table-test forced-click visibility race. Created TASK-107 before its one-line spec-only fix; 20 focused repeats, 126+5 browser cases, 297 unit tests, frontend/contracts/policy gates and G-REVIEW all passed locally. User explicitly authorized one follow-up push/final validation attempt; normal pre-push typecheck/lint passed and 32a5d20 (fix 02da522 plus task record) was pushed. No gates were weakened, no benchmark/Rust/application/workflow files changed in the follow-up.
- 2026-10-20 — FINAL HOSTED EVIDENCE: PR #6 https://github.com/duktofn/Collectives/pull/6, head 32a5d20a28e3908fd2db757f872dd062b4f8d3db; run 39383835890 https://github.com/duktofn/Collectives/actions/runs/39383835890 completed SUCCESS. Jobs: frontend 118498860705 SUCCESS (297 tests, hook/policy/frontend/contracts); browser 118498860935 SUCCESS (126 main + 5 Phase 6); backend (windows-latest) 118498860914 SUCCESS (Rust 1.97.0 x86_64-pc-windows-msvc fmt/Clippy/locked all-target tests); phase0-smoke 118498860873 SUCCESS (fixture reproducibility, harness and schema; 4 JSON artifacts). The evidence-based fix passed this final attempt; no further code change or gate audit was triggered. TASK-107 and TASK-100 are Done, archived locally in 01296a2 and f6e2e44; these documentation-only closures are not additional PR code changes.
- 2026-10-20 — After all four jobs passed, attempted only the authorized main protection readback through the GitHub connector. It returned HTTP 403 Resource not accessible by integration. PR readback confirms open/unmerged at 32a5d20. Leave TASK-099 Paused for that exact integration-permission blocker and separately unauthorized merge/fresh-main evidence. PR description updated with the successful run and blocker. No merge, branch-protection mutation or extra CI rerun; unrelated .gitignore and completed TASK-106 baseline files preserved.

- 2026-10-20 — User explicitly authorized merge and fresh main CI. Pushed only the committed ledger records (32a5d20..34c9b9c), preserving unrelated .gitignore; normal pre-push typecheck/lint passed. Waited for all four final PR jobs to succeed. Re-read PR open/head34c9b9c, mergeable=true and mergeable_state=clean; merged PR #6 normally with expected_head_sha guard. Merge SHA f6042394fbec4c114ed9c5a8c8fd302429b92cbb. No override, settings change or other PR merge.
- 2026-10-20 — Waited for fresh main run 39417711656 to complete; all four Windows jobs SUCCESS. Public main readback confirms f6042394fbec4c114ed9c5a8c8fd302429b92cbb, protected=true and the four required GitHub Actions checks. Detailed protection readback again returns HTTP 403 Resource not accessible by integration. Fresh-main requirement and Step 4 are complete; TASK-099 remains Paused solely for unverified current detailed flags, not CI or merge. No speculative code changes or gate weakening; TASK-106 baseline and pre-existing .gitignore edit preserved.
- 2026-10-20 — Resumed TASK-099 at user direction to close Phase A. GitHub public branch readback confirms current `main` f6042394 is protected and requires the four canonical Windows jobs; detailed branch-protection GET again returns 403. Merged current `origin/main` into `codex/phase-a-audit-fixes` as c1cd960 without file changes. TASK-104/TASK-106 follow-up PR CI and fresh-main evidence are now the next steps.
- 2026-10-21 — PR #7 containing TASK-104/TASK-106 audit follow-ups and the `.opencode` ignore change passed all four Windows jobs, merged normally as `48fb04a`, and passed fresh main CI run `39462215074`. Rechecked detailed branch protection; the integration still returns 403. Paused at Step 5 without changing protection settings.
- 2026-10-21 — Reauthenticated the GitHub CLI as duktofn and verified the live main protection flags against policy. Fresh main CI run 39465424016 passed all four required Windows jobs; completed TASK-099 without changing protection settings.
