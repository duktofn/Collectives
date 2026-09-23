# Phase 4 — Design system and app shell report

Status: Phase 4 approved. Independent visual review signed the final before/after matrix. WP0 was independently approved before WP1–WP5 work.

## Scope delivered

- Added the ordered global cascade: `variables.css` → `design-tokens.css` → `design-aliases.css` → `design-system.css` → component CSS.
- Added semantic aliases over the existing persisted theme variables, including the existing `colorBody`/`--color-text-primary` path. Forced-colors, reduced-motion and focus-visible baselines are included.
- Added the TypeScript-AST/CSS design checker with valid/invalid fixtures. Production exemptions are zero; only two recorded legacy inline-style baselines remain in untouched modal/settings content.
- Added `ModalLayer` and the TypeScript `ModalFocusScope` controller. Dialog, ZIP conflict dialog and ThemePanel use the Portal-based modal surface. The app root is inert and `aria-hidden` while the ref-counted modal stack is open; focus wraps, Escape closes, opener restoration and safe fallback are covered.
- Rebuilt the four-slot shell: labelled sidebar, workspace header, normal-flow activity status and workspace body. EditorToolbar is rendered only in the workspace header; Editor no longer duplicates it. EmptyWorkspace has one primary New Collection CTA and secondary imports. Collapsed sidebar exposes one labelled 40px expand control.
- Preserved stores, IPC, selection, editor save/close/error actions, archive/settings/tree behavior and all Phase 1–3 runtime paths. No new command/event or raw Tauri import was added.
- Added shell, modal, App integration and accessibility regression tests. Frontend suite is now 93 tests.

## Evidence

Final additive run: `artifacts/phase4/phase4-wp5-final-20260823/`

- Phase 3 resolution: `baseline-source.json`, resolved from `artifacts/phase3/approved-manifest.json`.
- Preflight: `preflight.json`; protected-state baseline after Cargo restoration: `preflight-restored.json`.
- Before matrix: `artifacts/phase4/phase4-wp0-system-fixed/visual-before-manifest.json` (81 hashed PNGs, independently signed WP0 baseline).
- After matrix: `visual-after-manifest.json` (81 hashed PNGs, 3 viewports × 3 themes × 9 states).
- Brief/review: `visual-brief.json`, `visual-review.json`. The latter is signed by the independent reviewer.
- Structural artifact verification: `verify-artifacts.mjs` reports `pass` with zero failures; visual artifact verification reports 81 before + 81 after, System=light and DPI 125%.
- Reconciliation: `reconciliation-final3.json` passes with Cargo content SHA-256 `20202baf2da1bc0c1842a33774eaf3a573b830901a1b791e5d670a8ad46dacba` and empty binary diff SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- Windows observation: `windows-dpi-probe.json` and `windows-visual-observation.json`. The rebuilt release Tauri shell was observed through Computer Use; the scoped Win32 probe recorded 125% DPI. The Tauri process was then stopped by exact process identity.

## Verification

Passing commands:

- `node scripts/phase4/check-design-contract.mjs --check`
- `node scripts/ipc/generate-contracts.mjs --check`
- `node scripts/ipc/verify-handler-registry.mjs`
- `node scripts/ipc/check-boundaries.mjs` (0 production exemptions)
- `node scripts/phase0/verify-quality.mjs frontend`
- `npm run typecheck`, `npm run lint`, `npm run test -- --run --allowOnly=false`, `npm run build`
- `npm run phase0:frontend-bench` (pure-algorithm and jsdom-proxy labels retained)
- `cargo fmt --all -- --check`
- `cargo clippy --locked --all-targets -- -D warnings`
- `cargo test --locked --all-targets`: 19 library, 21 Phase 1, 2 Phase 2 IPC, 4 Phase 2 services, 6 Phase 3 incremental, 7 Phase 3 migration, 3 Phase 3 watcher; all pass.
- Phase 4 Playwright after capture: 81/81; contrast and viewport overflow assertions pass for every capture.
- Phase 4 concrete allowlist `git diff --check`: pass.

## Known limitations and rollback notes

- `visual-review.json` is signed by the independent reviewer; Code did not self-sign it.
- `npm run tauri build` was used once to rebuild the release binary for actual-window observation. Tauri CLI inserted `default-run` into the protected Cargo manifest; this was detected by fail-closed reconciliation and restored exactly to the pre-build fingerprints. Final gates did not invoke `tauri build` again.
- No production backend/Cargo/SQLite/watcher/IPC behavior was changed. Rollback of Phase 4 is bounded to the allowlisted frontend shell/token/modal files and additive evidence; all earlier artifacts remain preserved.
