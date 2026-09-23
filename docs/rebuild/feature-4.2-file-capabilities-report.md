# Feature 4.2 — File capabilities and source-safe editing

Status: implementation evidence ready for independent Review V2 inspection.

## Scope delivered

- Canonical `file-capabilities.v1` policy owns Markdown (`.md`, `.markdown`) and the approved text-source allowlist. The deterministic generator emits the TypeScript and Rust classifiers; duplicate, unknown-kind, uppercase, and missing-Markdown-owner negative fixtures fail closed.
- Ordinary `read_file` and FolderRef snapshot reads share the authoritative Rust decoder. FolderRef retains canonical containment and reparse validation before decoding. Snapshots optionally report `fileKind`, UTF-8 BOM, line-ending kind, and original byte size while preserving the original-byte version token.
- UTF-8 BOM display stripping, BOM/newline-preserving saves, unchanged mixed-newline byte preservation, dominant-newline selection, NUL/encoding/size/extension/regular-file classification, and `.markdown` FolderRef coverage are tested.
- The generated policy drives the file picker and tree visibility. Unsupported files remain visible but disabled with no selection/context action when hiding is off; they are filtered without affecting directories, groups, or persisted collection data when hiding is on.
- Text-source files use source-only CodeMirror extensions and mode restoration. Fenced-code replacement covers only inner source ranges, leaves source lines available at the cursor, and does not make the full `FencedCode` node atomic. Chart widgets expose an accessible `Edit chart source` control.
- Fenced-code ownership is single-owner: `code-block-widget.ts` owns non-chart fenced traversal, widget/source-line decorations, and pointer-to-source selection; `render-decorations.ts` contains no `FencedCode` branch. Focused jsdom coverage derives pointer coordinates from rendered code text, exercises click/drag and Arrow/Home/End boundary entry, and asserts no duplicate widgets/lines or fenced atomic range.

## Approved predecessor and evidence

- Hotfix 4.1 resolver: `artifacts/feature42/feature42-20260824-final9/baseline-source.json`
- Selected Feature 4.2 run: `feature42-20260824-final9`
- Preflight: `artifacts/feature42/feature42-20260824-final9/preflight.json`
- Evidence/logs and synthetic fixture: `artifacts/feature42/feature42-20260824-final9/evidence.json`
- Artifact verification: `artifacts/feature42/feature42-20260824-final9/verification.json`
- Reconciliation: `artifacts/feature42/feature42-20260824-final9/reconciliation.json`

The synthetic fixture is deterministic and contains no external or user filesystem paths. Prior incomplete/failed Feature 4.2 probe runs remain preserved and are not selected as the baseline.

## Verification result

- Generated policy/checker: pass; 2 capability kinds, 34 extensions; all four negative fixtures rejected.
- IPC generator `--check`, 37-command/4-event registry, boundary checker, and Phase 4 design contract: pass.
- Frontend: typecheck, lint, build, and 112/112 tests pass. Canonical Phase 0 frontend verifier and pure/jsdom-proxy benchmark pass.
- Backend: rustfmt check, clippy with locked dependencies and `-D warnings`, and `cargo test --locked --all-targets` pass: 19 library tests, 3 Feature 4.2 tests, 4 Hotfix 4.1 tests, 21 Phase 1 tests, 4 Phase 2 service tests, 2 Phase 2 IPC tests, 6 Phase 3 incremental tests, 7 Phase 3 migration tests, and 3 watcher tests.
- Cargo.toml content SHA-256 remains `20202baf2da1bc0c1842a33774eaf3a573b830901a1b791e5d670a8ad46dacba`; exact binary diff SHA-256 remains the empty-diff value `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

## Limitations

This phase does not change archive, watcher, metadata schema, package, or Cargo dependency architecture. Synthetic visual evidence is a deterministic state/ownership contract rather than a new screenshot matrix; the Phase 4/5 visual infrastructure remains the visual baseline. No external/user path was read, copied, hashed, logged, or included in Feature 4.2 evidence.
