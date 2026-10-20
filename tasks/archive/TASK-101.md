## TASK-101 — Assert direct Windows pre-push hook invocation

**State:** Done
**Current Step:** Complete — hook-specific Windows frontend acceptance verified
**Phase:** Phase A Git hook follow-up
**Source ID:** User-directed Windows CI hook fix

### Description
Strengthen the Windows hook regression fixture by invoking `pre-push.mjs` directly against the invalid TypeScript fixture before testing Git’s actual `git push` hook path. Keep the lint-warning rejection and valid-push success cases unchanged.

### Scope
- `scripts/git/verify-pre-push.mjs`
- `scripts/git/install-hooks.mjs` (restore exact TASK-098 prerequisite omitted from this branch)
- `task.md` (integration and verification evidence)

### Related
- `task.md` → TASK-098 (canonical Windows path fix)
- `Collectives_Main_Architecture_Audit_Refactor_Plan_2026-10-19_v1.4(1).md` → Phase A / TASK-001

### Requirements
- [x] Direct invocation of `scripts/git/pre-push.mjs` rejects the fixture TypeScript error and prints diagnostics.
- [x] Actual Git push still rejects TypeScript and lint-warning fixtures and accepts a clean push.
- [x] `npm run test:hooks`, `npm run check:ci-policy`, frontend quality and contracts gates pass locally on Windows.
- [x] The latest hosted Windows frontend job passes.

### Steps
- [x] Step 1 — Add direct hook invocation assertion after successful fixture setup → verify: direct process exits non-zero and reports TS2322.
- [x] Step 2 — Run exact Windows hook fixture and quality gates → verify: negative and positive push cases remain meaningful.
- [x] Step 3 — Review scoped hook diff and latest hook PR frontend CI → verify: exact hook fixture/installer restoration reviewed; PR #3 frontend job 118148345680 succeeds at 7ca559e.

### Handoff
- Branch: `codex/phase-a-performance-baseline`; local hook integration: `02acf03`; original hosted-tested hook revision: `7ca559e`.
- Uncommitted files: unrelated pre-existing `.gitignore` edit preserved.
- Next action: none for TASK-101. New hosted evidence for the combined Phase A head requires owner-authorized batch push and PR update; no remote writes were performed.
- Blockers: none for original hook-specific acceptance. Full workflow/combined-head evidence is not claimed by this task.

### Verification
Local Windows with Node 20.19.0 / Git for Windows 2.56.0: `npm run test:hooks` and `npm run check:ci-policy` pass; frontend quality (typecheck, lint, 291 tests, build) and `npm run check:contracts` pass. Direct hook invocation returns non-zero with TS2322; actual type-error and lint-warning pushes are blocked; clean push succeeds. Hosted run 39278459779 is queued.

2026-10-20 GitHub connector readback: [PR #3](https://github.com/duktofn/Collectives/pull/3) is open at `7ca559e`. Latest [Windows frontend job 118148345680](https://github.com/duktofn/Collectives/actions/runs/39278459779/job/118148345680) is completed/success: hook and policy regressions, typecheck/lint/291 unit tests/build, and contracts all pass. Logs confirm Node 20.19.0, Git 2.56.0.windows.2 and Rust 1.97.0 x86_64-pc-windows-msvc. The fixture passes only after direct TS2322 rejection and real Git TS/lint rejection plus clean-push success. All four local authorized hook files exactly match hosted-tested 7ca559e. Current combined Phase A head has no hosted run; no claim that its full CI is green. Earlier queued notes above are historical and superseded by this readback. Local restored hook/frontend/contract/policy evidence is recorded in the 2026-10-20 Log; no tests repeated for this documentation-only closure.

### Log
- 2026-10-19 — Created from the user’s narrowed hook-only instruction; prior TASK-098 CI root cause is already fixed and recorded.
- 2026-10-19 — Direct hook invocation assertion added; all local Windows gates pass. Commit `7ca559e`; PR #3 workflow 39278459779 queued.
- 2026-10-19 — Paused after local pass while hosted run `39278459779` remained queued; followed the user instruction to move to another task.

- 2026-10-20 — Resumed by owner for combined Phase A CI. Read-only Git/source diagnosis confirmed this branch omits TASK-098 commits 9900d24/e457e81/a81e256/2c04582 and TASK-101 commit 7ca559e. Restore their exact two-file hook delta together as the prerequisite for the direct-invocation fixture; no new hook behavior or quality-gate relaxation. GitHub job 118148345680 in run 39278459779 passed hook, frontend (291 tests), and contract checks on Windows Rust 1.97.0 MSVC; original queued handoff is stale.

- 2026-10-20 — Restored only scripts/git/install-hooks.mjs and scripts/git/verify-pre-push.mjs; both exactly match 7ca559e (verified by empty git diff against that commit). Windows Node 24.20.0 / Git 2.55.0.windows.5: npm run test:hooks passes direct TS2322 rejection, real Git TS/lint blocking, clean push, fresh clone, custom-hook preservation and archive skipping. npm run check:ci-policy, npm run check:contracts and canonical frontend gate (typecheck/lint/297 tests/build) pass. Evidence: artifacts/task013/hook-verification.json; artifacts/phase0/quality-logs/quality-frontend-20261020034434994.json. G-REVIEW: no actionable findings. Unchanged backend/browser already passed at TASK-100 checkpoint with rustc 1.99.0 Windows MSVC (126+5 browser tests); no redundant rerun for hook-only integration. Paused only for combined hosted frontend result; no remote writes.

- 2026-10-20 — Verified local integration checkpoint commit: `02acf03` (TASK-101), including exact TASK-098 prerequisites. Combined hosted frontend evidence remains pending.

- 2026-10-20 — Owner corrected scope to Phase A plan TASK-001 / TASK-098 / TASK-101 hook evidence only. Stop TASK-099/TASK-100 work. Re-read GitHub connector: PR #3 remains open at 7ca559e; latest branch run 39278459779 completed, frontend job 118148345680 succeeded, including hook/policy, canonical frontend and contracts steps. The full workflow failure is outside this hook-specific frontend acceptance. All four authorized local hook files exactly match 7ca559e. No further code changes or validation are needed; the prior combined-branch evidence requirement does not block the original TASK-101 hook-specific acceptance. Current local HEAD 1961759 has zero hosted runs; any new combined-head evidence requires the deferred batch push and PR update, which remain unauthorized.

- 2026-10-20 — All original TASK-101 requirements verified after owner narrowed acceptance to the Windows hook/frontend gate. No source or UI files changed in this follow-up. Record evidence, then archive Done; do not push/merge.

- 2026-10-20 — Hosted hook evidence and scope correction committed in `158344c`; implementation remains `7ca559e` (original) / `02acf03` (local integration). Task Done and archived after all original hook-specific requirements passed.
