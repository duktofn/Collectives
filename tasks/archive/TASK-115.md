## TASK-115 — Resolve duplicate note links across collection entries and FolderRefs

**State:** Done
**Source ID:** Phase B v1.4 TASK-014; follows completed TASK-114 (plan TASK-013).
**Related:** DEC-CORE-01 (approved multi-candidate note-link behavior), DEC-019.
**Current Step:** Complete — audited and committed as 6f7807a.

### Description
Resolve same-name wikilinks across collection files, nested groups, and lazy FolderRef contents. When multiple valid notes match, expose every candidate in stable order and let the user choose or cancel without editing the Markdown source.

### Scope
- `src/lib/cm-extensions/wikilink-decoration.ts`, `wikilink-autocomplete.ts`, `wikilink-preview.ts`
- `src/lib/wikilink/resolver.ts`, `src/stores/collections.ts`, `src/components/editor/Editor.tsx`
- `src/lib/wikilink/wikilink.test.ts`, `src/features/links/application.ts`, `src/features/links/infrastructure/ipc.ts`, `src/features/links/index.ts`
- `src-tauri/src/metadata/repository.rs`, `link_index.rs`, `repositories/ports.rs` (exact `LinkRepository::resolve_all` and bounded FolderRef listing seams), `repositories/adapters.rs` (production implementations), `src-tauri/src/fs_ops.rs` (new metadata-only bounded FolderRef listing; ordinary tree listing stays unchanged), `ipc/commands/links.rs`, `ipc/dto.rs`, `application/domain.rs`, `application/services.rs`
- `src-tauri/src/application/services/note_link_tests.rs` — isolated note-link service test modules so the unchanged boundary gate scans only production service code.
- `src/App.tsx`, `src/App.test.tsx`, `contracts/ipc.v1.json`, generated `src/shared/ipc/generated.ts` and `src-tauri/src/ipc/generated.rs` via generators only, `src/shared/ipc/client.ts`, `src/types/index.ts`
- New `src/features/links/noteLinkContext.ts`, `src/features/links/noteLinkServices.ts` and `src/features/links/noteLinkServices.test.ts`, `src/features/filesystem/folderRefReadiness.ts` and `.test.ts`, `src/components/editor/NoteLinkCandidates.tsx`, `src/lib/wikilink/wikilink.test.ts`, `e2e/note-wikilink-duplicates.spec.ts`, `codebase.md`
- `src/components/editor/NoteLinkCandidates.test.tsx` — parent-owned independent behavioral regressions for keyboard choice/cancel and listbox semantics.
- Minimal task/context/decision/changelog records and ignored validation artifacts. Keep repository-port changes limited to exact link resolution and bounded FolderRef listing.

### Requirements
- [x] Return all valid same-name candidates in deterministic order; never choose an arbitrary first SQLite row.
- [x] Include files in nested groups and collapsed/unwatched FolderRefs, with a bounded traversal that fails closed when the candidate cap is reached.
- [x] Zero matches retain missing-link behavior; one match navigates directly; multiple matches show an accessible keyboard picker with a working cancel path.
- [x] Picker cancellation is distinct from a missing link, shows distinguishing paths, and supports Arrow/Home/End, Enter, Escape and focus restoration.
- [x] Reject late candidate/preview results after a collection switch, editor/session replacement, newer navigation request, or view disposal.
- [x] Surface a visible error for incomplete/capped traversal; never present a lone partial choice, and compare note names rather than joining note text into FolderRef paths.
- [x] Preserve heading/block fragments, existing name folding, collection isolation, and source Markdown bytes.
- [x] FolderRef candidates use the existing root-bound snapshot/selection path and remain safe to open.
- [x] Remove the `collectionsStore` ↔ wikilink-extension import cycle through an injected note-link context.
- [x] Windows typecheck/lint/full frontend tests/contracts/build and focused browser regressions pass; record the Windows compiler for Rust checks. Keep all existing assertions and timeouts.
- [x] Root independently audits the diff and evidence before a focused commit or Done state. No remote writes.

### Steps
- [x] Step 1 — Implement candidate IPC/resolution and injected context → verify: seven focused Rust note-link tests; 34 focused frontend tests; five browser cases covering missing, sole match, incomplete scan, duplicate cancel/fresh resolution and explicit choice; heading fragment and source-write behavior.
- [x] Step 2 — Run Windows correctness gates and affected browser regressions → verify: all scoped checks pass without changed assertions/timeouts.
- [x] Step 3 — Root audit and focused commit → verify: independent import-graph/source/provenance/data audit passed; commit 6f7807a recorded before archive.

### Handoff
- Branch: `codex/phase-b-08-11`; base: `3c06071`; TASK-115 changes were already uncommitted at resume.
- Next action: none. TASK-115 is complete; TASK-116 can start sequentially. DEC-019 and `codebase.md` record the accepted context boundary and current source map.
- Uncommitted files: `contracts/ipc.v1.json`, `decisions.md`, `e2e/note-wikilink-duplicates.spec.ts`, `src-tauri/src/application/domain.rs`, `src-tauri/src/application/services.rs`, `src-tauri/src/application/services/note_link_tests.rs`, `src-tauri/src/fs_ops.rs`, `src-tauri/src/ipc/commands/links.rs`, `src-tauri/src/ipc/dto.rs`, `src-tauri/src/link_index.rs`, `src-tauri/src/metadata/repository.rs`, `src-tauri/src/repositories/adapters.rs`, `src-tauri/src/repositories/ports.rs`, `src/App.tsx`, `src/components/editor/Editor.tsx`, `src/components/editor/NoteLinkCandidates.test.tsx`, `src/components/editor/NoteLinkCandidates.tsx`, `src/features/filesystem/folderRefReadiness.test.ts`, `src/features/filesystem/folderRefReadiness.ts`, `src/features/links/index.ts`, `src/features/links/infrastructure/ipc.ts`, `src/features/links/noteLinkContext.ts`, `src/features/links/noteLinkServices.test.ts`, `src/features/links/noteLinkServices.ts`, `src/lib/cm-extensions/wikilink-autocomplete.ts`, `src/lib/cm-extensions/wikilink-decoration.ts`, `src/lib/cm-extensions/wikilink-preview.ts`, `src/lib/wikilink/resolver.ts`, `src/lib/wikilink/wikilink.test.ts`, `src/shared/ipc/client.ts`, `src/shared/ipc/generated.ts`, `src/stores/collections.ts`, `src/types/index.ts`, `task.md`.
- Local-only ignored files: `CHANGELOG.md`; `artifacts/phase0/task115-candidate-build-6f9088f8886942c781fdd45a14b1d51f/{tauri-config.json,source-hashes.json,source-manifest.json,build.log,tauri-app-task115.exe}`; `artifacts/phase0/task115-playwright.config.mjs`.
- Blockers: none.

### Verification
Passed on Windows: `npm run typecheck`, `npm run lint`, `npm run test -- --run --maxWorkers=2` (56 files / 344 tests), `npm run check:contracts`, `npm run build`, `cargo fmt --all -- --check`, `cargo clippy --locked --all-targets -- -D warnings`, and `cargo test --locked --all-targets -j 1`. Focused browser command: `npx playwright test e2e/note-wikilink-duplicates.spec.ts --config=artifacts/phase0/task115-playwright.config.mjs` (5/5; a one-off ignored config overrides the repository filename filter without changing `playwright.config.ts`). Parent-owned picker tests passed 4/4. Rust compiler: `rustc 1.99.0 (b940084d7 2026-09-28)`.

Native candidate evidence: 40 measured samples plus 10 warmups across two fresh sessions, 200 visible and independently resolved links, unchanged target hashes, and clean unforced shutdown. Fixed-fixture IPC p95 improved 91.3 ms → 87.1 ms (-4.6%); CPU p95 0.578125 s → 0.53125 s (-8.1%); peak RSS p95 rose 7.3% and private memory p95 rose 13.9%. Baseline: `artifacts/phase0/task115-baseline-1792763327460/performance.json`; parent audit: `artifacts/phase0/task115-parent-evidence-result.json` and `task115-parent-target-bytes-audit.json`.

Frozen candidate: `artifacts/phase0/task115-candidate-build-6f9088f8886942c781fdd45a14b1d51f/tauri-app-task115.exe`, SHA-256 `73199F0AB0A20A1E5B22EBB27938965F469D9763ED3708FFA409F458A6F7A234`. The 32-file `source-hashes.json` SHA-256 is `49A7262B7AD0427FFFD8FD9F6E6A5EB8E9FCE6375D2EB642A70C4699A7B2B099`; `source-manifest.json` SHA-256 is `27FC50C50EDC9AB53BB7F135FFED587FA12CCDA0FDD5A3ACF9CE349D37F61408`. The frozen manifest maps `e2e/editor-wikilink-duplicates.spec.ts` to `1FDB99FF5A75BA27F694DD6D1737B3473DB8223EECA81353286AF1D4FC8B9FE4`; the renamed allowlisted `e2e/note-wikilink-duplicates.spec.ts` has the same content hash, so the candidate executable remains valid.

### Log
- 2026-10-23 — Created and started for the explicit request to finish Phase B plan tasks 014–015; TASK-114 is complete. Expanded the allowlist for the exact multi-result `LinkRepository` seam and bounded metadata-only FolderRef enumeration after audit showed the existing tree listing probes every file before traversal caps or safety checks; ordinary tree listing remains unchanged.
- 2026-10-24 — Resumed from HEAD `3c06071`; reconciled the handoff with the existing uncommitted TASK-115 changes and recorded the current next action. No source changes were made during startup inspection.
- 2026-10-24 — Step 1 complete. Frontend services and navigation lifecycle are injected, the chooser is wired and accessible, stale FolderRef starts are guarded, byte accounting uses the strongest available snapshot/listed/content size, and Windows junction setup asserts success. Focused Rust tests passed 7/7; focused Vitest passed 34/34 before the two cache-key assertions were added; TASK-115 browser regressions passed 5/5; TypeScript typecheck passed; `npm run check:contracts` passed after extracting tests and adding the identity port. Step 2 continues with final Windows gates and independent audit.
- 2026-10-25 — Step 2 complete. Windows frontend/typecheck/lint/contracts/build, five affected browser cases, Rust fmt, Clippy and locked all-target tests passed; candidate comparison passed under root audit. The focused browser regression now uses the original allowlisted filename and was run with `npx playwright test e2e/note-wikilink-duplicates.spec.ts --config=artifacts/phase0/task115-playwright.config.mjs`.
- 2026-10-25 — Candidate source and build provenance frozen at `artifacts/phase0/task115-candidate-build-6f9088f8886942c781fdd45a14b1d51f`; 32 source hashes match. The renamed E2E file retains the same SHA-256 as its pre-build path, so its filename-only move does not invalidate the candidate binary. No task commit has been made; root source audit and final commit remain.
- 2026-10-25 — Root completed independent source, runtime import-graph, binary/32-file source-manifest, native raw-sample, 200-target-byte, profile ownership, and picker/backend test audits. Committed as `6f7807a`; marked Done and archived. No remote writes.
