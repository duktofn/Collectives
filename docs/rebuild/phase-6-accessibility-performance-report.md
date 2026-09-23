# Collectives Phase 6 accessibility and performance report

Phase 6 implementation scope is limited to WP0, WP1, WP2, WP3 and the non-optimization WP5 probes. The implementation preserves the Phase 0–5 contracts and does not change package or Cargo manifests, dependencies, SQLite, IPC, archive, watcher, FolderRef token or file-capability behavior.

## Evidence protocol

Each run is unique under `artifacts/phase6/<run-id>/` and records preflight runner data, predecessor hashes, fixture digest, accessibility contract results, staged frontend inventory, performance raw samples, CSP/stage probes, Gate E package state and reconciliation hashes. Existing predecessor artifacts are read-only inputs.

The accessibility coverage is emulated through existing Vitest/Playwright infrastructure for keyboard and pointer parity, role/name, focus cleanup, 800x600, 1024x768, 1280x800, 200% text zoom, forced-colors and reduced-motion. Actual Windows keyboard/focus observation is recorded as unavailable unless a preconfigured controlled runner is supplied; OS accessibility, privacy, security, DPI and display settings are not changed.

## WP0–WP2

- `scripts/phase5/resolve-predecessors.mjs` has mutually exclusive `--check` and `--generate` modes. Check mode only reads/stat/hashes an existing baseline and generate mode uses a new run directory plus `wx` output creation.
- The sidebar owns one role tree with roving tab stops, stable identities, visible-item traversal, typeahead expiry, deterministic focus fallback and disabled unsupported entries.
- Context menus use menu/menuitem/separator semantics, pointer and Shift+F10/Menu-key opening, bounded focus movement, single activation and opener restoration.
- Move targets use a labelled native radio group. The collection switcher is a labelled native button and listbox with collection options and action buttons outside the listbox.
- CodeMirror content attributes retain native textbox/contenteditable semantics while adding dynamic filename/mode/read-only/described-by metadata. The announcer owns polite/assertive live regions; visual activity status is not a live region.

## WP3 and Gate E

The performance baseline separates jsdom, browser and native metric classes. Browser scenarios retain five warmups and twenty raw samples with p50, p95, MAD, coefficient of variation, long-task count/max and failures. The budget proposal is lower-is-better and remains inconclusive until two independent same-runner sessions and native controlled-runner data exist; it authorizes zero WP4 production changes.

The staged Tauri configuration sets the approved Collectives title/product name and exact CSP, including the approved `font-src` asset sources. Gate E remains `BLOCKED` while the pinned Tauri CLI cannot be preflighted on an approved controlled runner. No Phase 6 approved manifest is created in that state.

## Limitations and rollback

The generated, untracked Phase 5 and Phase 6 run directories were discarded during the requested workspace cleanup and are not included in this commit. Rerun the corresponding workflows to regenerate their evidence before relying on those run records.

Native startup/memory process-tree measurements, controlled Tauri CSP probes, installer inspection and actual OS keyboard/focus observation remain unavailable in this runner. The unique evidence run is unreferenced by an approved manifest. Rollback is a new source-authorized task naming only the Phase 6 files; no reset, checkout, cleanup or predecessor overwrite is used.
