## TASK-089 — Focus development and CI on Windows

**State:** Done
**Current Step:** Completed — Windows scope and policy verified

### Description
Apply the user's instruction to focus only on Windows. Pause Linux/macOS work and make required CI checks match this scope.

### Scope
AGENTS.md, README.md, .github/workflows/ci.yml, .github/main-branch-protection.json, scripts/ci/verify-policy.mjs, task/decision/codebase/plan records, GitHub main protection and draft PR #2.

### Requirements
- [x] Persistent instructions and task records specify Windows-only work; TASK-086 paused.
- [x] All required CI jobs run Windows and policy requires exactly their four contexts.
- [x] Validate policy locally and apply/read back GitHub protection.

### Steps
- [x] Step 1 — Update instructions/workflow/policy → verify: policy validation and diff review.
- [x] Step 2 — Apply remote policy and publish review branch → verify: read-back and PR checks.

### Handoff
- Branch: main; base: 31cd13f.
- Next action: publish focused commit to existing review PR #2; TASK-014 owns subsequent CI history.
- Blockers: none.

### Verification
Windows local Node 24.20.0 / Rust 1.99.0: policy validation, lint, PowerShell smoke syntax, deterministic fixture comparison, smoke harness and artifact schema all pass. Smoke run: phase0-20261019081749571-31cd13f-c62a9b2d. GitHub PUT and independent GET confirm exactly four Windows check contexts, app 15368, strict=true and admins enforced. Previous pinned Rust 1.97.0 Windows backend CI passed (39196174399). New full CI execution is tracked by TASK-014; this task does not claim it passed.

### Log
- 2026-10-19 — Created and started from explicit Windows-only instruction. TASK-014 proof committed as 31cd13f before starting this scope.

- 2026-10-19 — Completed Windows scope conversion, paused TASK-086, recorded DEC-013. Local smoke and policy checks pass; remote protection read-back verified. No runtime platform implementations removed.
