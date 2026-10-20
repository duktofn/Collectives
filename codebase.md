# Codebase Context
Last Updated: 2026-10-21
Last Reviewed Commit: 3dbe5e4

The editor and settings sections describe the current code-block and typography-control implementation. Source code takes precedence. Backend descriptions summarize existing boundaries; this session did not audit backend behavior.

# Project Overview
Collectives is a local-first Markdown/text knowledge-management desktop app. Collections contain file entries, lazy external folder references, and virtual groups. SolidJS owns application UI and editor state; Tauri/Rust owns document I/O, metadata, archive transactions, settings, and filesystem watching.

# Tech Stack
- App version: 0.4.0 (`package.json`).
- SolidJS ^1.9.3, TypeScript ~5.6.2, Vite ^6.0.3, Tauri JavaScript/Rust v2.
- CodeMirror 6; @codemirror/lang-markdown ^6.5.0, @lezer/markdown ^1.6.4.
- Chart.js ^4.5.1, highlight.js ^11.11.1, js-yaml ^5.1.0.
- Vitest ^4.1.9 with jsdom, Playwright ^1.62.1.
- Rust backend uses SQLite/rusqlite, notify, blake3, zip, serde, tokio, and UUIDs.

# Project Structure
- `src/App.tsx`: application composition, modal/rendering state and workflow wiring. `workflows/AppLifecycleWorkflow.ts` owns startup, global/close subscriptions and the lease/save close barrier; `workflows/NavigationWorkflow.ts` owns the selection queue and search/history navigation.
- `src/components/`: shell, sidebar/tree, common dialogs/menus, editor, and theme settings UI.
- `src/stores/`: Solid store singletons (`collections`, `editor`, `ui`).
- `src/features/`: application APIs and infrastructure IPC adapters for archive, collections, editor, filesystem, links, and settings.
- `src/workflows/`: composition boundaries and operation leases for archive/settings/navigation flows.
- `src/platform/`: Tauri dialog, window-lifecycle, and asset gateways.
- `src/shared/ipc/`: typed IPC client, errors, generated command/event types.
- `src/lib/cm-extensions/`: CodeMirror Markdown rendering, source presentation, input rules, tables/charts, links, selection, layout, and history integration.
- `src/lib/wikilink/`: parsing, resolution, and document/fragment navigation.
- `src/lib/themeEngine.ts`, `src/styles/`: theme variables, custom fonts, tokens, and application styles.
- `src/visual-fixtures/`, `e2e/`: editor/shell browser fixtures and regression specs.
- `src-tauri/src/application/`: application services and domain re-exports.
- `src-tauri/src/ipc/`: thin Tauri commands, DTO conversions, generated handler registration.
- `src-tauri/src/repositories/`: repository ports, adapters, safe document persistence.
- `src-tauri/src/metadata/`: SQLite schema, migration, revisioned repository, legacy conversion.
- `src-tauri/src/collection/`: collection model, JSON compatibility persistence, archives/import journals.
- `src-tauri/src/fs_layer/`: filesystem watching and file-identity tracking.
- `src-tauri/src/settings.rs`, `font_manager.rs`, `theme_io.rs`: persisted appearance/font settings.
- `contracts/`, `scripts/`: IPC/file-capability manifests, generators, quality checks, release builder.
- `.githooks/pre-push`, `scripts/git/`: versioned typecheck/lint guard, local installer and real Git push fixture checks (`npm run test:hooks`). `prepare` configures local hooks after dependency installation.
- `docs/rebuild/`: prior implementation/evidence reports; inspect source before treating reports as current behavior.

# Architecture
Frontend dependency direction:
`App / components / workflows → stores / feature application APIs → feature infrastructure → shared/ipc/client → Tauri commands`.

Backend dependency direction:
`ipc/commands + DTOs → application/services::AppServices → repository ports → production adapters / SQLite / local files / notify`.

`src/lib/tauri.ts` is a compatibility facade; use feature indexes and platform/shared gateways for new production calls. Generated registry files come from contract manifests. UI workflow callbacks coordinate navigation rather than putting document switching in tree rows.

# Layers / Modules

## Editor
`components/editor/Editor.tsx` owns one EditorView, mode compartments, store synchronization, selection/navigation, measurement requests, and idle/force autosave. CSS presentation lives in `components/editor/Editor.css` and shared styles.

`lib/cm-extensions/markdown-mode.ts` composes base Markdown support and Read / Write / Source extensions. Markdown parsing adds the local table extension and Lezer Strikethrough. Text-source files use separate source-language extensions and a read-only variant for Read mode.

`RenderPlugin` in `render-decorations.ts` owns inline/heading/blockquote/rule decorations and hidden atomic marker ranges. It refreshes on document, selection, viewport, syntax-tree, and configuration changes. In Write mode, bold, italic, strikethrough, and inline code retain their styles and expose parser delimiter nodes for intersecting selections. The closing boundary stays exposed until the caret leaves, giving native input a DOM position after the marker. Active empty star/underscore formatting pairs are shown instead of a horizontal rule. In Read mode and inactive spans, delimiters are replaced and atomic.

`inline-formatting.ts` shares native/draft span discovery between rendering and keyboard handling. Active whitespace drafts are parsed using a temporary same-length projection; the document is unchanged during preview. Its Write-only transaction filter moves trailing whitespace outside closing markers when the caret leaves. The Write Enter binding in `formatting-keymap.ts` finishes terminal emphasis/strike markers and composes the existing Markdown/normal newline command into one undoable transaction; mid-content, code, and Source Enter retain normal behavior.

`delimiter-pairs.ts` supplies shared pure `getDelimiterEdit` rules to the editor and table cells: pairing, selection wrapping, closing-marker overtyping, and single closing input for unmatched marker runs. Literal code markers and list bullets do not create false pending spans. Its input handlers avoid paste/drop/composition. `formatting-keymap.ts` and `formatting-utils.ts` own bold/italic/strike shortcuts, list prefixes/indent, line movement, and code-block toggles.

`code-block-widget.ts` renders code using source-backed line decorations and code-language/fence widgets. `table-model.ts` parses cells; `table-widget.ts` renders tables and manages cell input/history/controls. Widget equality includes read-only state, and mutation handlers recheck it so Write DOM cannot remain editable after switching to Read. Markdown Enter and user document transactions are guarded in Read mode. `chart-widget.ts` renders chart fences and invokes `ChartEditorDialog` for editing chart specs.

`CodeLanguageWidget` renders a native copy button styled as the language label. Its click handler resolves the live fenced block through `EditorView.posAtDOM`, copies the body using `navigator.clipboard.writeText`, and provides temporary success/failure feedback plus app announcements. It preserves code whitespace, omits fence lines, and clears feedback timers when its DOM is destroyed. Buttons work in Read and inactive Write blocks without changing document selection.

`editor-layout.ts` observes rendered blocks/fonts for measurement changes and installs `displayedTextPointerSelection` from `pointer-selection.ts`. Pointer selection resolves the displayed glyph before measurements can move the viewport. Wikilink and block-reference extensions resolve/navigation through the links feature and editor store.

## Settings UI
`components/theme/ThemePanel.tsx` owns a local settings draft, validation, Apply/reset, and pending-operation locks. Its top-level categories are Appearance and Behavior; Appearance contains Theme and Typography sections. `SettingsSelect` supplies the shared dropdown behavior. `SettingsNumberInput` wraps native number inputs for Line height and Font scale with themed minus/plus buttons, positive minimum bounds, and decimal increments; it reports changes to ThemePanel's draft and inherits the form fieldset's disabled state.

## Stores and workflow coordination
`features/editor/documentSession.ts::createDocumentSession` owns open path/content, dirty/mode/file-kind state, generations/revisions, version tokens, the serialized save queue/barrier, conflicts and recovery lifecycle. `stores/editor.ts` exposes one session as `editorStore` and injects UI selection. Each session has independent request/queue/content-reader state; `sessionKey` identifies the current view lifetime. Editor owns the CodeMirror view and resets its history on a new session key.

`collectionsStore` owns collections, active selection, validation, watcher synchronization, CRUD/archive flows, metadata caches, and legacy/v2 event listeners. `uiStore` owns tree selection/expansion and sidebar state.

`operationLease.ts` registers pending work so close handling waits for archive/settings operations. Workflow components compose dialogs and callback boundaries. Common modal components own portal stacking, focus wrapping, Escape handling, and focus restoration.

## Backend persistence
`AppServices` is managed Tauri state and directly calls repository ports. Production adapters are composed in `AppServices::from_app`; tests can use `from_repositories`.

`SqliteMetadataRepository` implements collection/metadata repository behavior over `metadata-v1.sqlite`. Legacy collection JSON remains available for compatibility and migration. `MigrationService` stages and verifies migration output and maintains durable recovery/state markers. The revisioned mutation protocol includes expected revisions, mutation IDs, changes, bounded feed cursors, and snapshot fallback.

`repositories/documents.rs` reads UTF-8 snapshots, classifies file capabilities, checks folder-reference containment, preserves line-ending/BOM metadata, uses explicit `WritePrecondition` (Version/CreateNew/Overwrite) with BLAKE3 tokens for conditional writes, and replaces via temporary files. Missing parents return `parent_missing` without recreating folders. A staged-file RAII owner closes its handle and removes its temporary path on precommit failures. Committed saves return the new token plus cleanup/durability warnings; editorStore treats these as success and exposes a dismissible `saveNotice`. Preserve generation/revision and conflict checks in callers.

`collection/archive.rs` and `import_transaction.rs` own preflight, staged import/export publication, journals, and recovery. `WatchManager` wraps notify and emits compatibility events plus bounded v2 change batches; frontend cursor gaps/overflow require reconciliation.

# Key Classes / State Owners
- `EditorView` (CodeMirror): current document, selections, transactions, extensions, and rendered DOM.
- `RenderPlugin`: rendered Markdown marks/replacements and atomic marker ranges.
- `createDocumentSession`, `editorStore`, `collectionsStore`, `uiStore`: session and frontend state owners described above.
- `AppServices`: managed backend service composition using repository ports.
- `SqliteMetadataRepository`, `MigrationService`: metadata persistence and migration/recovery boundaries.
- `WatchManager`, `FileIdentityCache`: filesystem subscriptions/feed and identity tracking.
- `Collection` / recursive `Entry`: collection tree model (`File`, `FolderRef`, `Group`).
- `SafetyError`: structured backend error with code, message, and details.

# Code Flow
1. Native startup: `lib::run → import_transaction::recover → AppServices::from_app → manage services / watcher / identity cache → generated_ipc_handler`.
2. Open file: tree/workflow callback → `editorStore.openFile` → editor feature IPC → document repository snapshot → store → EditorView document replacement.
3. Quick Open / overview / content search: selectEntry → await App selectionTransition → verify selection and collection still match → fallback openFile only if needed; avoid competing opens.
4. Edit/save: CodeMirror transaction → Editor store content/dirty update → autosave/flush → serialized conditional document write → snapshot/version-token update.
5. Inline editing: selection transaction → RenderPlugin rebuild → active marker text exposed / atomic ranges removed → ordinary keyboard or native input updates document; exiting span restores rendered delimiters.
6. Metadata/watch events: typed IPC listeners → revision/cursor validation → cache/store continuity update, or snapshot reconciliation on gaps/malformed data.
7. Close: AppLifecycleWorkflow close handler → wait for operation leases → flush/close editor → destroy after successful save; failures retain the draft. Lifecycle cleanup is registered synchronously and releases subscriptions that resolve after disposal.

# Notes
- `npm run test -- --run src/lib/cm-extensions` runs editor unit regressions. `npx playwright test e2e/editor-inline-formatting.spec.ts` exercises actual typing, arrow navigation, list continuation, and pointer insertion.
- Full frontend commands: `npm run typecheck`, `npm run lint`, `npm run test -- --run`, `npm run build`.
- Releases use `npm run release:build`; English entries go under Unreleased in `CHANGELOG.md` unless a target version is requested.
- `AGENTS.md` is tracked from TASK-085 so repository policies travel with commits. `codebase.md`, `task.md`, `decisions.md`, and `CHANGELOG.md` remain locally ignored by `.gitignore`; changes still exist on disk.
- Frontend validation baseline (2026-10-18): `npm run typecheck` and `npm run lint` pass with zero warnings after TASK-006 corrected the two test-only diagnostics.
- Backend Windows baseline (2026-10-18, Rust 1.99.0): canonical backend fmt/clippy/test gates pass after TASK-008. Native Linux/macOS checks in TASK-086 are paused under DEC-013; Windows CI still uses pinned Rust 1.97.0. TASK-087 resolves LNK4098 with opt-level=1 only for libz-ng-sys in dev (also inherited by test); rebuilt native zlib-ng uses MSVCRT. The full backend gate rerun passes without LNK4098.


- TASK-089 / DEC-013: current implementation and CI scope is Windows-only. TASK-086 native Linux/macOS checks are paused. `.github/main-branch-protection.json` and `scripts/ci/verify-policy.mjs` keep the four Windows required jobs aligned; smoke commands use PowerShell.

- Branding: `src/assets/logo.svg` is the supplied Collectives logo for favicon/title bar/welcome. `src-tauri/icons` Windows PNG/ICO variants were regenerated; existing non-Windows icons unchanged.
- Sidebar Add Markdown files reads picked Markdown paths; missing paths are created exclusively before adding collection metadata. Existing files are never overwritten.

- `fs_layer/owned_artifacts.rs` recognizes the exact three document staging/backup filename forms with canonical UUID v4. Watcher filters these before queueing and delivery, retaining real rename endpoints as modified; `fs_ops::read_children` excludes owned files from folder trees.

- TASK-096 reimports the updated 27×27 logo from the same supplied path and regenerates Windows icons with reduced source padding. TASK-022 cleanup remains paused with no implementation retained; TASK-021 only filters owned artifact visibility/events.

- TASK-109 / DEC-017: document-session extraction is present but paused pending complete native validation; consult task.md before treating it as accepted. TASK-110/111 are not implemented.
