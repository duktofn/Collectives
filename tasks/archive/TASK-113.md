## TASK-113 — Investigate bounded content-search rescans

**State:** Done
**Source ID:** Phase B v1.4 TASK-012, depends on completed TASK-111 (plan TASK-011).
**Current Step:** Complete — independently audited and committed as 457ab12.
**Ownership:** Luna 6 MAX implements; root audits independently. User explicitly requested this delegation.

### Scope
- src-tauri/src/repositories/content_search.rs
- src-tauri/src/application/services.rs
- src/features/links/application.ts
- src/components/search/ContentSearchDialog.tsx
- src/features/links/requestGeneration.test.ts
- src-tauri/tests/phase2_services.rs
- NEW src-tauri/tests/content_search_consistency.rs
- NEW src/benchmarks/content-search.bench.ts
- Minimal task ledger/archive and ignored validation artifacts.

### Acceptance
- Measure repeated query/page costs. Optimize only if material; evidence-only/no-production-change closure is explicitly allowed by the plan.
- Preserve results, snippets, UTF-16 ranges, truncation, ordering, case folding, collection isolation and every existing read cap. No FTS migration or increased quotas.
- Preserve stale request rejection and external edit freshness; any snapshot must be bounded and keyed/invalidate correctly.
- G-CODE: frontend typecheck/lint/full tests/contracts/build/applicable browser; Windows Rust fmt/Clippy/all-target tests. Do not weaken assertions or timeouts.
- G-DATA: real NTFS external edit/read failure/Unicode/path and collection isolation checks; preserve file bytes/hashes.
- G-PERF if production hot path changes: same fixed fixtures/controlled Windows release runner, >=2 sessions, 5 warmups + >=20 samples/scenario, p50/p95/errors/CPU/Tauri-WebView2 process-tree RAM; targeted p95 <= baseline*1.15 and >=10% measured hot-path work reduction if initially material. Do not claim global final-build typing/cold-start/lifetime budgets are already met.
- Root independently audits diff, tests and evidence before commit/Done. No push/PR/merge/remote changes.

### Handoff
- Branch: codex/phase-b-08-11; initial HEAD fe44849; source initially clean.
- Plan source recovered from original attachment tool output in session 01a15931-4b4a-7c91-9662-9881af101ae8, line 266; original Downloads file is absent.
- Next action: none; implementation and independent audit complete.
- Current tracked changes: src-tauri/src/repositories/content_search.rs, new src-tauri/tests/content_search_consistency.rs, and this TASK-113 entry. Final candidate report: artifacts/phase0/task113-content-search-1792630849505-ddb6fff2-1620-4178-9ee0-713718e952c9/. No commit or Done state was made before parent audit.
- Baseline finding: 40 measured samples and 10 warmups per workload over two fresh sessions; p95 IPC latency is 975.5 ms for one 2,000-file page, 4,902.2 ms for five same-page calls, 5,866 ms for five pages, and 292.7 ms for five calls over 100 files. Repeated 2,000-file scenarios scan 10,000 files per sample. Both sessions exited 0 with no forced cleanup or remaining process IDs; fixture hashes were unchanged.

### Verification
- Windows backend: `cargo fmt --all -- --check`, `cargo test --all-targets -j 1` (120 passed), and `cargo clippy --all-targets -j 1 -- -D warnings` passed on Rust 1.99.0 x86_64-pc-windows-msvc.
- Frontend: typecheck/lint, full Vitest (54 files, 321 passed), IPC/boundary contracts, production build, and the focused content-search browser test passed. Build retains the existing chunk-size advisory; frontend source was unchanged.
- Native baseline/candidate: 2 fresh sessions each, 5 warmups + 20 samples per workload/session, stable response hashes, zero errors, unchanged fixture byte hashes, and clean unforced process cleanup. Candidate p95 IPC latency was below baseline for all four scenarios: single 2,000-file page 920.9 ms vs 975.5; five same-page calls 4,510.1 ms vs 4,902.2; five-page sequence 4,591.7 ms vs 5,866; five calls over 100 files 256.1 ms vs 292.7.
- Candidate process-tree CPU p95 fell 12.1% for one 2,000-file page, 7.5% for same-page repeats, 17.6% for five-page navigation, and 15.9% for 100-file repeats. The five-page workload meets the >=10% material-work reduction gate; matcher-call unit tests also confirm repeated unchanged files bypass rematching while files are still reread/token-checked. Process-tree RSS p95 was recorded in both reports; candidate increases ranged from 1.6% to 4.1% per workload.
- Evidence: `artifacts/phase0/task113-content-search-1792598755348-1feeb3a3-7d05-4927-90d6-ae4b1e55da99/performance.json` and `artifacts/phase0/task113-content-search-1792630849505-ddb6fff2-1620-4178-9ee0-713718e952c9/performance.json`. Candidate executable: `artifacts/phase0/task113-candidate-build-53b66305fa1b4a10be6c6f009ad90d7f/tauri-app-task113-candidate.exe`.
- Independent root audit: reran Windows fmt, all-target tests (120 top-level tests; the migration suite also runs one child-process test), and Clippy with warnings denied on Rust 1.99.0 MSVC. All passed. An ignored audit harness compared 884 responses against the frozen original across Unicode, paging, repeated queries, reversed index rows, changed contents and overlapping FolderRefs; all matched. The temporary test include was removed and the integration file's original byte hash restored.
- Independently recomputed p50/p95 from all raw samples, verified executable/current-source hashes and response hashes across baseline/candidate, and checked actual retained native fixture copies (3,010 files/session), not only the fixture source directories. All four sessions matched the source byte hashes. Evidence: `artifacts/phase0/task113-audit/parent-evidence-result.json`, `parent-retained-fixtures-result.json`, `parent-differential-v2.log`, and `parent-all-targets.log`.
- Original plan's TASK-012 names `content-search.bench.ts` in its allowlist, not as a mandatory deliverable. The actual native IPC harness satisfies the measurement requirement; no frontend proxy benchmark was added. Cache hits validate current byte tokens rather than depending on watcher delivery. Public APIs, module boundaries, and frontend stale-request handling are unchanged.
- Complete: implementation commit `457ab12`. Native results describe IPC response time, not dialog rendering or global typing budgets; no hosted CI or non-Windows claim.

### Log
- 2026-10-21 — Created for explicit user request: Luna 6 MAX implements plan task 12; root audits. Documentation kept minimal per prior user direction.
- 2026-10-21 — User requested a fresh session for token savings. Prior Luna prepared only an ignored native harness, then stopped; source implementation, measurements and final audit remain pending.
- 2026-10-21 — Audited the ignored native harness before execution. Found missing fixture-byte rehashes and an app-data isolation check that ran after launch; baseline withheld while these are fixed.
- 2026-10-21 — Hardened the ignored harness and re-audited its guards. Node syntax and fixture verification passed for smoke (3,115 files), standard (1,005), and large (10,005); the frozen binary embeds only the isolated phase0 identifier, with source and matcher provenance verified. Native measurement is next.
- 2026-10-21 — Native baseline passed in two fresh Windows sessions: all four scenarios had 5 warmups + 20 samples/session, stable response hashes, zero errors, and clean exit/descendant cleanup. Five 2,000-file pages took p95 5.866 s versus 975.5 ms for one page; identical repeats also rescanned 10,000 files. Fixture byte hashes matched before/after, so the measured repeated work is material and cache reuse must validate current file content on every request.
- 2026-10-21 — Implemented a one-entry per-file match cache keyed by collection/query/index/path identity and each live FileSnapshot version token; every request still enumerates and reads current files, and incomplete scans are not cached. The new Windows consistency suite passed 6/6, and the unit test passed showing repeated pages make no additional matcher calls while still reporting the same scanned-file count. Rust compiler: 1.99.0 x86_64-pc-windows-msvc. Full gates and candidate native comparison remain pending.
- 2026-10-22 — Windows backend `cargo test --all-targets -j 1` passed 119 tests; Clippy passed with `-D warnings`. Frontend typecheck/lint, full Vitest (54 files, 321 tests), IPC/boundary contracts, production build, and the focused content-search browser entry test passed. Production build retained the existing >500 kB advisory; no frontend source changed. Candidate release build and native comparison remain pending.
- 2026-10-22 — Built the Windows release candidate with the phase0 identifier overlay using Rust 1.99.0 MSVC. Candidate SHA-256 `0bdad6f9ee747107eb9ea1048d2a2f9e9fb8789025dff8d26211d5f31c3b4229`; binary contains the isolated identifier and not `com.collection.note`. Retained baseline profile markers validated and the active isolated profile root is absent. Native candidate measurement is next.
- 2026-10-22 — First candidate run completed both fresh sessions with stable responses, zero errors, unchanged fixture hashes, and clean cleanup, but failed acceptance: combined repeat-2000 p95 was 6.812 s (baseline 4.902 s) and CPU p95 6.891 s (baseline 5.219 s). Session 0 improved while session 1 had large repeat-only outliers. SQLite link search has no ORDER BY, and the cache currently keys the index in returned row order; make cache identity/order lookup deterministic before another comparison.
- 2026-10-22 — Canonicalized index/path cache identity and changed per-file lookup to stable candidate keys. The reversed-row-order regression and all content-search unit tests pass; full backend gates and another candidate comparison remain pending.
- 2026-10-22 — After the order-independent key update, `cargo test --all-targets -j 1` passed 120 Windows tests and Clippy passed with warnings denied. The prior candidate remains a failed-comparison checkpoint; rebuild and two-session remeasurement are next.
- 2026-10-22 — Rebuilt the order-independent candidate with Rust 1.99.0 MSVC. SHA-256 `d7fabfed9e92f1fda0578af6969125d1ca3bde4f4435c9804bc77351deb5b4eb`; its binary embeds the isolated phase0 identifier and not `com.collection.note`. Fresh candidate measurement is next.
- 2026-10-22 — Order-independent candidate run 2 completed with stable response hashes, zero errors, unchanged fixtures, and clean cleanup. Combined p95: repeat-2000 5.100 s (+4.0% vs baseline), page sequence 4.804 s (-18.1%); page-sequence CPU p95 fell 14.2%. The 100-file control p95 was 466 ms (+59%) due to four slow session-1 samples. Code review found repeated hits rebuilt the entire per-file HashMap; remove that avoidable cost and measure again.
- 2026-10-22 — Changed full cache hits to reuse the existing immutable Arc without allocating/rebuilding the per-file map; content changes still clone and update the bounded entry. `cargo test --all-targets -j 1` passed 120 tests and Clippy passed with warnings denied. Rebuild and candidate remeasurement remain pending.
- 2026-10-22 — Built the no-map-rebuild candidate with Rust 1.99.0 MSVC. SHA-256 `c14401e527fe31c849b569a0fb1b521e3b936ec6208071ceb092152083134b64`; embedded phase0 identifier matches and production identifier is absent. Native candidate run is next.
- 2026-10-22 — Final candidate passed all four p95 latency comparisons, process-tree metrics, correctness/hash checks, fixture before/after hashes, and two-session cleanup. Page-sequence CPU p95 improved 17.6%; all full Windows gates passed. Implementation and evidence are ready for root's independent audit; no commit or Done transition yet.
- 2026-10-22 — Root independent audit passed: no blocking code findings; 884 frozen-original comparisons, full Windows backend gates, raw native metrics/hash verification and all four actual searched fixture copies passed. Recovered the original plan text and confirmed a separate Vitest benchmark is optional. Ready for focused TASK-113 commit.

- 2026-10-22 — Committed verified implementation as `457ab12`; marked Done after independent audit and archived this entry. No remote writes.
