# Codebase Context

Last Updated: 2026-09-22
Last Reviewed Commit: b19023a57ea000d56c7d7000b5607287d49d6b4e

Repository state: this document also reflects the uncommitted working-tree changes present during the review on 2026-09-22. The source files are authoritative if the working tree and this document diverge.

# Project Overview

Collectives is a local-first personal knowledge-management desktop application. Users organize existing Markdown and text files into collections without requiring cloud storage or copying folder references into an application-owned vault.

The application has a SolidJS/TypeScript frontend hosted by Tauri v2 and a Rust backend. The frontend owns shell composition, collection navigation, CodeMirror editing, themes, accessibility behavior, and client-side state. The backend owns collection persistence, metadata/index storage, safe document I/O, archive transactions, filesystem watching, file-identity tracking, settings, fonts, and the typed Tauri IPC surface.

The collection model is a recursive tree of:

- file entries, which point to individual files;
- folder-reference entries, which point to external directories and are browsed lazily;
- virtual groups, which own child entries.

Important product systems are:

- Markdown and text-source editing with CodeMirror 6;
- live Markdown decorations, fenced-code widgets, tables, charts, wikilinks, and block references;
- collection CRUD, groups, folder references, relinking, and move detection;
- SQLite metadata migration, revisioned mutations, link indexing, and bounded filesystem change feeds;
- conflict-aware autosave with external-change detection;
- transactional folder/ZIP import and export;
- theme and custom-font management;
- keyboard-accessible tree, menus, dialogs, modal focus, live announcements, and workflow-level operation leases.

# Tech Stack

## Frontend

- TypeScript with strict compiler settings; the declared compiler version is approximately 5.6.2.
- SolidJS 1.9.x with Vite 6 and vite-plugin-solid.
- CodeMirror 6, @lezer/markdown, and language-data for Markdown and source editing.
- Chart.js 4.5.x for chart fenced-code widgets.
- highlight.js 11.11.x for fenced-code previews.
- js-yaml 5.1.x for chart/widget parsing.
- Tauri JavaScript APIs and dialog, filesystem, and opener plugins, major version 2.
- Vitest 4.1.x with jsdom and Solid testing utilities.
- Playwright 1.62.x for visual, accessibility, and performance scenarios.

## Backend

- Rust 1.97.0, configured in rust-toolchain.toml.
- Tauri 2 with serde/serde_json DTO serialization.
- rusqlite 0.31.0 with the bundled SQLite engine.
- notify 6.1.1 for filesystem watching.
- zip 1.1.4 for archive operations.
- blake3 for file and transaction digests.
- file-id 0.2.1 for move/rename identity tracking.
- uuid 1.8 with v4 identifiers.
- chrono 0.4.38 for persisted timestamps.
- tokio 1.x for bounded blocking work such as parallel collection validation.
- base64 and tempfile for supporting functionality and tests.

## Contracts and build configuration

- contracts/ipc.v1.json is the source manifest for the typed IPC command and event contract.
- contracts/file-capabilities.v1.json is the source manifest for supported Markdown and text-source extensions.
- scripts/ipc/generate-contracts.mjs generates frontend and Rust IPC registries.
- scripts/feature42/generate-file-capabilities.mjs generates frontend and Rust file-capability registries.
- The frontend uses Node.js 20.19.0 from .nvmrc.
- src-tauri/tauri.conf.json configures the Collectives application shell, Vite dev server, production frontend bundle, and CSP.

# Project Structure

~~~text
Collectives/
├── src/
│   ├── App.tsx                         Application composition and lifecycle
│   ├── a11y/                           Live-region announcer
│   ├── components/
│   │   ├── common/                     Dialogs, modal layers, context menus, icons
│   │   ├── editor/                     CodeMirror editor and toolbar
│   │   ├── shell/                      Four-slot application shell and status UI
│   │   ├── sidebar/                    Collection list and sidebar
│   │   ├── theme/                      Theme/font settings controls
│   │   └── tree/                       Collection and folder-reference tree
│   ├── features/                       Public feature APIs and IPC adapters
│   │   ├── archive/
│   │   ├── collections/
│   │   ├── editor/
│   │   ├── filesystem/
│   │   ├── links/
│   │   └── settings/
│   ├── lib/
│   │   ├── cm-extensions/              CodeMirror extensions and widgets
│   │   ├── wikilink/                    Parsing, resolution, and navigation
│   │   ├── editorMeasure.ts             Cross-component editor measurement requests
│   │   ├── themeEngine.ts               CSS variables and custom @font-face rules
│   │   └── tauri.ts                     Compatibility re-export facade
│   ├── platform/                       Dialog, window, and asset gateways
│   ├── shared/
│   │   ├── ipc/                         Typed invoke client, errors, events, registries
│   │   └── fileCapabilities.generated.ts
│   ├── stores/                          Solid state singletons
│   ├── styles/                          Variables, design tokens, aliases, system CSS
│   ├── types/index.ts                   Frontend domain and wire-facing types
│   ├── visual-fixtures/                 Phase 4–6 controlled UI fixtures
│   └── workflows/                       Workflow containers and operation coordination
├── src-tauri/
│   ├── src/
│   │   ├── application/                 Domain re-exports and application services
│   │   ├── collection/                  Collection model, JSON compatibility, archives
│   │   ├── fs_layer/                    Watcher and file identity tracking
│   │   ├── ipc/                         Tauri commands, DTOs, generated handler
│   │   ├── metadata/                    SQLite schema, migration, repository, legacy source
│   │   ├── repositories/                Repository ports and concrete adapters
│   │   ├── file_capabilities_generated.rs
│   │   ├── font_manager.rs
│   │   ├── fs_ops.rs
│   │   ├── link_index.rs                Legacy link-index implementation
│   │   ├── safety_error.rs
│   │   ├── settings.rs
│   │   └── theme_io.rs
│   ├── tests/                           Rust integration tests for the rebuild phases
│   ├── Cargo.toml
│   └── tauri.conf.json
├── contracts/                            IPC and file-capability manifests
├── docs/rebuild/                         Phase safety, boundary, metadata, UI, and QA reports
├── e2e/                                  Playwright visual/accessibility/performance specs
├── scripts/                              Contract generators, boundary checks, evidence runners
├── test-fixtures/                        Contract and design-boundary fixtures
├── package.json
├── README.md
├── rust-toolchain.toml
└── codebase.md
~~~

Generated evidence under artifacts/ and build outputs are validation inputs, not runtime architecture. They should not be used as a substitute for inspecting the source.

# Architecture

## Dependency direction

~~~text
App / shell / workflows / UI components
        ↓
Solid stores and feature application APIs
        ↓
Feature infrastructure IPC adapters
        ↓
shared/ipc/client.invokeCommand + typed CommandMap
        ↓
Rust ipc::commands + DTO conversions
        ↓
application::services::AppServices
        ↓
Repository ports
        ↓
SQLite metadata, legacy JSON compatibility, local files,
archives, settings/fonts, link index, and notify watcher
~~~

The frontend feature indexes are the preferred production boundary. Each feature exposes application functions from application.ts and keeps direct invokeCommand calls in infrastructure/ipc.ts. src/lib/tauri.ts remains a compatibility facade that re-exports feature APIs, shared IPC errors/types, and platform APIs.

The Rust command layer is intentionally thin. ipc/commands/* receives Tauri State, converts DTOs, calls application services, and converts the result back to DTOs. AppServices is constructed once in lib.rs and stored as managed Tauri state. Its ports are Arc<dyn ...> values so production adapters and test fakes share the same application-service boundary.

## Persistence architecture

The current backend is a compatibility migration architecture:

1. Legacy collection JSON files remain the authoritative migration source before canonical metadata is established.
2. MigrationService stages metadata-v1.sqlite, validates tree/index parity, runs SQLite integrity and foreign-key checks, checkpoints WAL sidecars, and publishes a digest-verified state marker.
3. SqliteMetadataRepository implements both CollectionRepository and MetadataRepository. Normal collection reads and writes use SQLite rows with a recursive tree reconstruction.
4. Compatibility saves continue writing collection JSON through collection::manager so the legacy representation remains synchronized with successful metadata writes.
5. The metadata database contains collection revisions, normalized entries, durable change envelopes, mutation records for idempotency, bounded feed state, and a composite link index.
6. The old link-index.db implementation remains in link_index.rs for compatibility/migration paths; the production AppServices composition uses SqliteMetadataLinkRepository against metadata-v1.sqlite.

This is an actual hybrid implementation. The normal collectionsStore CRUD methods currently invoke the ordinary CRUD IPC commands and reload/snapshot state. The revisioned apply_collection_mutation_v2 command, migration commands, metadata snapshots, and v2 event/cache path are also implemented and exposed for the metadata protocol.

## Event architecture

WatchManager wraps notify and maintains watched file/folder maps plus a stream cursor. It emits the original four events for compatibility and also emits bounded filesystem-changes-v2 batches. Metadata mutations emit collection-delta-v2 after a successful application-service mutation.

The frontend collectionsStore installs listeners for both legacy and v2 events. Metadata cache application is atomic: revision gaps, malformed changes, unknown kinds, cursor gaps, overflow, or invariant failures trigger one snapshot reconciliation. Editor continuity logic preserves or marks a local draft when an entry path changes, is removed, or its watched file changes externally.

## Safety boundaries

SafetyError is the structured backend error contract with code, message, and JSON details. Document reads validate the generated file capability, regular-file status, UTF-8, NUL exclusion, and a 10 MiB limit. Writes use expected BLAKE3 tokens for optimistic external-change detection, temporary files, flushes, replacement, and directory synchronization where supported.

Folder-reference reads validate symlink/reparse components, canonical containment under the selected folder root, readiness of the child path, and regular-file status. Archive operations preflight paths, members, conflicts, and quotas; stage output and metadata; persist ownership/digest journals; and recover or block unsafe transactions instead of silently deleting user data.

# Layers / Modules

## Frontend application layer

### App composition

App.tsx owns startup/restore, global error handling, close-request serialization, collection import flows, selection transitions, settings loading, theme registration, workflow composition, and the activity/error surfaces. It passes workflow callbacks into the shell and tree instead of letting tree components own collection-switch or document-selection transitions.

### Stores

- collectionsStore owns collection state, active collection selection, validation, watcher synchronization, JSON-compatible CRUD flows, archive flows, v2 metadata caches, snapshot fallback, move prompts, and legacy/v2 event listeners.
- editorStore owns the open document, dirty state, editor mode, file kind, conditional version token, generation/revision counters, pending selection/navigation, and a serialized save queue.
- uiStore owns selected entry, expanded tree nodes, sidebar visibility/width, and the persisted hide-unsupported-files preference.

### Features

- features/collections owns collection IPC adapters plus normalized metadata cache projection, revision checks, cursor checks, and snapshot materialization.
- features/editor owns document IPC adapters and pure metadata/filesystem continuity decisions.
- features/filesystem owns watcher IPC adapters, folder-child reads, folder-reference feed filtering, readiness state, retry/cancellation, and generation-token protection.
- features/archive owns folder/ZIP import, export, conflict-check, and resolution calls.
- features/links owns wikilink resolve/search calls.
- features/settings owns settings, font, and theme import/export calls.

### Workflow and platform layer

- workflows/operationLease.ts blocks window close until registered archive/settings operations settle.
- workflows/ArchiveWorkflow.tsx keeps import dialogs mounted while asynchronous operations are pending and registers operation leases.
- workflows/SettingsWorkflow.tsx hosts the ThemePanel workflow.
- workflows/TreeWorkspace.tsx and DocumentWorkspace.tsx provide callback boundaries for navigation and document rendering.
- workflows/CollectionWorkspace.tsx owns the collection workspace body boundary.
- platform/dialogs.ts, windowLifecycle.ts, and assets.ts isolate direct Tauri dialog/window/asset imports.

### Presentation and editor layer

The shell uses four slots: labelled sidebar, workspace header, normal-flow activity status, and workspace body. ModalLayer plus ModalFocusScope provide portal stacking, inert/aria-hidden app-root behavior, focus wrapping, Escape handling, and opener restoration.

Editor.tsx creates one CodeMirror EditorView, reconfigures mode compartments, updates content through editorStore, maintains accessibility content attributes, measures widget/layout changes, and schedules 2-second idle or 15-second force saves. CodeMirror mode extensions separate Markdown render, Markdown source, and text-source behavior.

lib/cm-extensions contains Markdown decorations, formatting keymaps, delimiter pairs, wikilink decoration/autocomplete, block references, tables, charts, fenced-code widgets, syntax highlighting, annotations, and empty widgets. lib/wikilink parses note names/fragments, calls the links feature, and navigates to headings or block IDs.

## Backend application layer

### Application services

application/domain.rs re-exports the domain DTO-facing types and defines BrokenEntry and ResolveCandidate. application/services.rs implements use cases for collections, metadata mutations/migration, documents, links, archives, settings/fonts/themes, watcher operations, identity-cache initialization, and moved-entry detection.

### IPC layer

ipc/dto.rs defines camelCase wire DTOs and conversions for collections, entries, settings, snapshots, metadata requests/results, watcher cursors, events, and archive conflicts. ipc/generated.rs is generated from contracts/ipc.v1.json and supplies the command metadata plus the tauri::generate_handler! registry. The current contract has 37 ordinary command records and 6 metadata/transition command records.

### Repository layer

repositories/ports.rs defines Send + Sync ports for:

- CollectionRepository
- MetadataRepository
- ArchiveRepository
- DocumentRepository
- SettingsRepository
- FilesystemRepository
- LinkRepository

repositories/adapters.rs supplies production adapters for the collection/metadata repository, archives, documents, settings/fonts/themes, filesystem/watcher, and the legacy link-index interface. repositories/documents.rs contains the safe file snapshot/read/write implementation.

### Metadata layer

metadata/schema.rs creates schema version 1 with collection rows, normalized entry rows, collection_changes, mutation_records, change_feed_state, link_index, migration_state, and migration_backups. MetadataRepository applies expected-revision mutations in a SQLite transaction and records idempotent mutation results.

metadata/legacy_source.rs loads and validates legacy collection JSON, flattens recursive entries into rows, builds the source link index, rejects duplicate IDs/orphans/cycles/sibling-order collisions, and reconstructs entries from rows.

metadata/migration.rs owns staged migration and recovery. It records owner markers, journals, backups, operation status, source/target digests, fsync/WAL evidence, same-volume capability, and states including planned, importing, verifying, publishing, committed, rolled-back, and rollback-pending.

### Collection and archive layer

collection/model.rs defines Collection, CollectionMetadata, and the Entry tree. collection/manager.rs keeps path-based JSON persistence and recursive tree manipulation available for compatibility. collection/archive.rs implements safe folder/ZIP import/export, archive member validation, conflict discovery, conflict-resolution validation, path rebasing, staged publication, and fault-tested recovery. collection/import_transaction.rs journals collection asset/metadata publication and rollback.

### Filesystem and document layer

fs_layer/watcher.rs manages notify subscriptions, per-collection watch specifications, legacy event emission, v2 bounded batches, stream/subscription cursors, and overflow signaling. fs_layer/file_identity.rs caches file IDs and scans candidate folders to detect external moves/renames. fs_ops.rs normalizes paths and reads sorted directory children.

repositories/documents.rs classifies supported files through the generated capability table, reads UTF-8 snapshots with BOM/line-ending metadata, checks folder-reference containment, performs conditional writes, preserves existing line endings/BOM where possible, and uses safe temporary-file replacement.

### Secondary services

- link_index.rs contains the legacy SQLite link index and name search/resolve logic.
- settings.rs persists settings.json and defines Settings and CustomFont.
- font_manager.rs imports/deletes application-owned font files.
- theme_io.rs imports/exports theme settings and font metadata.
- file_capabilities_generated.rs is generated from the file-capabilities contract.
- safety_error.rs defines the structured error type and mapping from legacy string errors.

# Class Index

## App

Path: src/App.tsx

Responsibility: top-level Solid component that composes the application shell, loads/restores collections and settings, serializes close and selection transitions, and coordinates archive/settings/tree/document workflows.

State and owned coordination:

| Name | Type | Purpose |
|---|---|---|
| isNewCollectionOpen | Accessor<boolean> | Controls the create-collection dialog |
| newCollectionError | Accessor<string> | Displays create-collection validation/errors |
| appNotice | Accessor<{ title: string; message: string } \| null> | Displays user-facing operation failures |
| isSettingsOpen | Accessor<boolean> | Controls SettingsWorkflow |
| settings | Accessor<Settings> | Holds loaded and edited theme/font settings |
| globalError | Accessor<{ message: string; stack?: string } \| null> | Stores uncaught browser errors/rejections |
| archive signals | folder path/name and ZIP destination/conflicts | Tracks archive dialog state |
| operationLeaseRegistry | OperationLeaseRegistry | Prevents close while archive/settings operations are active |

Important functions:

- createCloseRequestHandler(close, destroy, onError): prevents native close, awaits the close transaction, and destroys the window only after a successful flush.
- createAppCloseTransactionHandler(...): waits for operation leases before flushing and destroying.
- onMount(...): installs announcers/error handlers/close listeners, restores the last collection and selection, loads settings/fonts, and installs collection event listeners.
- handleImportFolderClick/Confirm and handleImportZipClick/Confirm: run picker, conflict, operation-lease, and collection import flows.
- getSelectedEntryInfo(): resolves manifest entries or lazy folder-reference child paths for the workspace.

Relations:

- calls collectionsStore, editorStore, uiStore, feature APIs, platform gateways, and workflow components;
- passes requestSelect/requestFolderRefSelect/requestSwitch callbacks into TreeWorkspace;
- owns AppShell and its workspace slots.

## collectionsStore

Path: src/stores/collections.ts

Responsibility: reactive collection state and synchronization coordinator.

State:

| Name | Type | Purpose |
|---|---|---|
| collections | Collection[] | Loaded collection tree snapshots |
| activeCollectionId | string \| null | Current collection, persisted to localStorage |
| loading | boolean | Collection load state |
| error | string \| null | Last collection/archive failure |
| brokenEntries | BrokenEntry[] | Missing or invalid manifest targets |
| movePrompt | object \| null | External move/rename prompt data |
| normalizedCaches | Map<string, MetadataCacheState> | Revisioned normalized metadata and watcher cursors |

Important methods:

- loadCollections, openCollection, createCollection, renameCollection, deleteCollection;
- addFiles, addFolderRef, createGroup, renameGroup, removeEntry, deleteGroupAndPromote, moveEntry, relinkEntry;
- watchActiveCollection, validateActiveCollection, reloadActiveCollection, reloadCollectionSnapshot;
- importFolder, importZip, exportCollectionToFolder, exportCollectionToZip;
- initializeListeners, handleCollectionDeltaV2, handleFilesystemChangesV2;
- getFolderRefWatchCursor and clearMovePrompt.

Relations:

- calls features/collections, archive, and filesystem;
- listens through shared/ipc/events;
- updates editorStore continuity and uiStore selection;
- clears the wikilink decoration cache after collection snapshots/mutations.

## editorStore

Path: src/stores/editor.ts

Responsibility: document selection/editing state and serialized conditional save behavior.

State:

| Name | Type | Purpose |
|---|---|---|
| openFilePath | string \| null | Current document path |
| openFileContent | string | Last content known to be persisted |
| currentContent | string | Current editor document |
| isDirty/isSaving | boolean | Save state |
| mode | EditorMode | view, edit-source, or edit-render |
| isReadOnly | boolean | Prevents writes/mode changes for read-only documents |
| error | string \| null | Structured/legacy save or read failure formatted for UI |
| pendingNavigation | WikilinkFragment \| null | Delayed heading/block navigation |
| pendingSelection | string \| null | Selection transition awaiting save |
| versionToken | string | BLAKE3 token used for conditional writes |
| generation/revision | number | Rejects stale async selection/save results and identifies immutable snapshots |
| fileKind | FileKind \| null | markdown or text-source |
| lastMarkdownMode | EditorMode | Restores Markdown mode after reload |

Important methods:

- openFile, saveFile, flushPendingSave, closeFile, reloadAndDiscard, selectEntry;
- beginFolderRefSnapshot and commitFolderRefSnapshot;
- updateContent, setMode, navigateTo, clearPendingNavigation;
- applyMetadataContinuity and applyFilesystemConflict.

The save queue stores immutable path/generation/revision/content/expectedToken snapshots. Writes drain serially; newer snapshots remain queued after earlier writes or failures, and a newly persisted token is used for the next write of the same open file.

## uiStore

Path: src/stores/ui.ts

Responsibility: tree navigation and shell preferences.

State: expandedNodes, selectedEntryId, isSidebarOpen, sidebarWidth, and hideUnsupportedFiles.

Important methods: toggleSidebar, setSidebarOpen, setSidebarWidth, setHideUnsupportedFiles, toggleExpand, setExpanded, isExpanded, selectEntry, isSelected, and reset.

## folderRefReadiness

Path: src/features/filesystem/folderRefReadiness.ts

Responsibility: protects lazy folder-reference child selection from stale reads and selection races.

State and methods:

- FolderRefIntent carries collection ID, folder-reference ID, root/child paths, watcher cursor, and editor generation.
- FolderRefReadinessRecord carries checking/ready/broken status, structured error, and retryability.
- requestFolderRefChild flushes pending edits, starts a new editor generation, and selects the child.
- resolveFolderRefIntent reads a contained snapshot with bounded retry delays for retryable stale reads.
- cancelFolderRefReadiness invalidates timers/in-flight operations.
- retryFolderRefChild and retryFolderRefChildFromEvent restart retryable reads after user action or a matching filesystem feed.

## Editor

Path: src/components/editor/Editor.tsx

Responsibility: CodeMirror view owner. It creates/destroys the EditorView, wires document changes to editorStore, reconfigures mode/file-kind compartments, updates accessible content attributes, requests measurements, handles Ctrl/Cmd+S, and starts idle/force autosave timers.

Relations:

- reads and writes editorStore;
- uses cm-extensions/markdown-mode and wikilink/resolver;
- renders editor error actions for retry, reload/discard, and close.

## AppShell and workflow components

Paths:

- src/components/shell/AppShell.tsx
- src/workflows/TreeWorkspace.tsx
- src/workflows/CollectionWorkspace.tsx
- src/workflows/DocumentWorkspace.tsx
- src/workflows/ArchiveWorkflow.tsx
- src/workflows/SettingsWorkflow.tsx
- src/workflows/operationLease.ts

Responsibilities:

- AppShell owns the sidebar/header/activity/body slot layout, collapsed-sidebar expansion, and notice layer.
- TreeWorkspace forwards navigation callbacks to Sidebar.
- CollectionWorkspace and DocumentWorkspace provide explicit workspace ownership boundaries.
- ArchiveWorkflow keeps import dialogs mounted while folder/ZIP operations are pending.
- SettingsWorkflow hosts ThemePanel and its long-running operations.
- createOperationLeaseRegistry exposes register, activeCount, activeLabels, waitForIdle, and idempotent lease release.

## MetadataCacheState and continuity helpers

Paths:

- src/features/collections/metadataCache.ts
- src/features/editor/metadataContinuity.ts

MetadataCacheState normalizes entries by collectionId:entryId, stores parent/child order, collection revisions, metadata-feed cursor state, and fallback count. applyCollectionDelta and applyFilesystemFeed reject invalid or non-contiguous input and request a snapshot fallback. materializeCollection rebuilds the recursive Entry tree.

applyMetadataContinuity updates selected/open paths for clean documents and marks dirty documents as externally conflicted when metadata changes. applyFilesystemConflict performs the same decision for direct file changes.

## AppServices

Path: src-tauri/src/application/services.rs

Responsibility: one managed composition of backend application ports.

Fields:

| Name | Type | Purpose |
|---|---|---|
| collections | Arc<dyn CollectionRepository> | Collection reads and compatibility CRUD mutations |
| archive | Arc<dyn ArchiveRepository> | Staged folder/ZIP import/export |
| documents | Arc<dyn DocumentRepository> | Safe document snapshots and writes |
| settings | Arc<dyn SettingsRepository> | Settings, fonts, and themes |
| links | Arc<dyn LinkRepository> | Wikilink resolution/search/index maintenance |
| filesystem | Arc<dyn FilesystemRepository> | Directory reads, watches, and identity tracking |
| metadata | Option<Arc<dyn MetadataRepository>> | Revisioned metadata/migration service when running in production |
| app | Option<tauri::AppHandle> | Event emission for v2 metadata deltas |

Important methods:

- from_app constructs production adapters and triggers metadata migration.
- from_repositories constructs test composition from fake ports.
- collection/document/archive/settings/link/filesystem functions implement application use cases.
- apply_collection_mutation_v2 applies a metadata mutation and emits collection-delta-v2.
- reconcile_collection_snapshot synchronizes watcher specs and returns a metadata snapshot.

## Collection, Entry, and SafetyError

Paths:

- src-tauri/src/collection/model.rs
- src-tauri/src/safety_error.rs

Entry is a serde-tagged recursive enum with File(id, path), FolderRef(id, path), and Group(id, name, children). Collection owns id, schema_version, name, created_at, updated_at, entries, and optional validation metadata.

SafetyError owns code, message, and JSON details. new and with_details construct structured failures; Display emits code and message; From<String> maps known legacy safety prefixes into stable codes.

## SqliteMetadataRepository

Path: src-tauri/src/metadata/repository.rs

Responsibility: SQLite-backed CollectionRepository, MetadataRepository, and metadata link repository implementation.

Fields:

- db_path: metadata-v1.sqlite location;
- collections_dir: compatibility JSON root;
- migration: MigrationService responsible for canonical-state and recovery policy.

Important methods:

- new/from_app, collections_dir, db_path, with_connection;
- get_all, load, save, delete, add_entry, remove_entry, move_entry, delete_group_and_promote;
- read_changes_since and save_full_compatibility;
- apply_mutation, migration_status, retry_migration, snapshot.

Relations:

- reads/writes metadata schema and uses legacy_source flatten/reconstruct helpers;
- calls MigrationService after canonical writes;
- implements repository ports consumed by AppServices;
- updates the metadata link_index from affected rows during incremental mutations.

## MigrationService

Path: src-tauri/src/metadata/migration.rs

Responsibility: durable, digest-verified migration from legacy collection JSON/link-index data to metadata-v1.sqlite.

Fields and related records: MetadataPaths, MigrationJournal, OwnerMarker, BackupRecord, OperationStatus, DurabilityEvidence, MetadataStateMarker, MigrationParity, MigrationResult, RecoveryReport, and VolumeCapability.

Important methods: paths, status, recover, migrate, mark_first_canonical_mutation, ensure_canonical_integrity, and volume_capability.

Relations:

- consumes load_authoritative_snapshot from legacy_source;
- creates schema and checks SQLite/WAL/foreign-key integrity;
- publishes state only after parity/digest verification;
- validates ownership and either recovers or blocks unsafe journal states.

## WatchManager

Path: src-tauri/src/fs_layer/watcher.rs

Responsibility: notify-backed file/folder subscription manager and bounded event-feed publisher.

Fields:

- watcher: the notify watcher;
- watched_files and watched_folders: path-to-entry mappings;
- collection_id: current feed collection;
- app_handle: Tauri event emitter;
- cursor: stream ID, subscription epoch, and sequence.

Important methods: new, init, watch_file, unwatch_file, watch_folder, unwatch_folder, clear_all, sync_paths, sync_collection_paths, sync_collection_specs, and current_cursor.

Feed invariants:

- a 150 ms receive window batches events;
- each batch is capped at 256 changes;
- a bounded sync channel signals overflow;
- cursor stream/subscription/sequence values let the frontend reject gaps;
- legacy events and filesystem-changes-v2 are emitted together.

## DocumentSnapshot and document repositories

Path: src-tauri/src/repositories/documents.rs

DocumentSnapshot fields: content, version_token, file_kind, had_utf8_bom, line_ending, and byte_size.

DocumentFileRepository adapts read_file, read_folderref_snapshot, and write_file to DocumentRepository. The implementation classifies extensions from the generated file-capability table, limits files to 10 MiB, rejects invalid UTF-8/NUL/non-regular files, verifies expected tokens twice around temporary replacement, and preserves BOM/line-ending conventions.

# Code Flow

## Native startup and frontend restore

~~~text
Tauri lib::run()
  -> collection::manager::get_collections_dir()
  -> collection::import_transaction::recover()
  -> AppServices::from_app()
       -> MigrationService::migrate()
       -> SqliteMetadataRepository + archive/documents/settings/links/filesystem adapters
  -> manage AppServices
  -> initialize WatchManager and manage WatchState
  -> manage FileIdentityCache
  -> generated_ipc_handler!()
  -> App.onMount()
       -> load collections and restore localStorage collection/selection
       -> initialize collection listeners
       -> load settings/fonts and applyThemeSettings()
~~~

## Opening a collection

~~~text
Sidebar collection action
  -> collectionsStore.openCollection(id)
       -> editorStore.closeFile() if needed
       -> set activeCollectionId and reset UI selection/tree
       -> collections feature initializeIdentityCache()
       -> filesystem feature syncCollectionWatches()
       -> collectionsStore.validateActiveCollection()
       -> detect external moves for broken entries
~~~

## Selecting and editing a normal file

~~~text
Tree FileNode selection
  -> App requestSelect / editorStore.selectEntry()
  -> flush current save if dirty
  -> App selection effect resolves manifest entry
  -> editorStore.openFile(path)
       -> features/editor.readFile()
       -> ipc::commands::documents::read_file()
       -> DocumentFileRepository::read()
  -> Editor replaces CodeMirror document
  -> CodeMirror updateListener
       -> editorStore.updateContent()
  -> 2 s idle or 15 s force timer
       -> editorStore.saveFile()
       -> conditional write_file(expectedToken)
       -> temporary file + flush + replacement
       -> reread snapshot and update versionToken
~~~

## Selecting a folder-reference child

~~~text
FolderRefChildRow click
  -> requestFolderRefChild(intent)
       -> editorStore.flushPendingSave()
       -> beginFolderRefSnapshot() and generation token
       -> select child path and set readiness=checking
  -> resolveFolderRefIntent()
       -> read_folderref_snapshot(rootPath, childPath)
       -> containment/reparse/readiness validation in backend
       -> retry only retryable stale reads
       -> commitFolderRefSnapshot() if generation and selection still match
       -> readiness=ready or broken
~~~

## Standard collection mutation

~~~text
Sidebar/tree action
  -> collectionsStore method
  -> feature collection application API
  -> typed invokeCommand()
  -> ipc::commands::collections/*
  -> application::services
  -> CollectionRepository (SqliteMetadataRepository)
  -> SQLite normalized rows and compatibility JSON
  -> link-index maintenance where required
  -> store reload/snapshot + watcher synchronization
~~~

## Revisioned metadata mutation and snapshot fallback

~~~text
MetadataMutationRequest
  -> apply_collection_mutation_v2
       -> check mutation_id replay
       -> compare expected_revision
       -> apply direct row/index delta in BEGIN IMMEDIATE
       -> persist collection revision/change envelope/metrics
       -> emit collection-delta-v2
  -> collectionsStore.handleCollectionDeltaV2()
       -> applyCollectionDelta()
       -> materializeCollection()
       -> editorStore.applyMetadataContinuity()
       -> snapshot reconciliation on a gap or invariant failure
~~~

The same fallback policy applies to filesystem-changes-v2 when the collection ID, cursor, sequence, event shape, or overflow state is not trusted.

## Filesystem watcher flow

~~~text
collectionsStore.watchActiveCollection()
  -> derive file and expanded folder WatchSpec values
  -> sync_collection_watches()
  -> WatchManager::sync_collection_specs()
  -> notify event callback -> bounded worker batch
  -> legacy file-modified/entry-deleted/entry-renamed/folder-changed
  -> filesystem-changes-v2 with cursor and overflow
  -> collectionsStore/editorStore/FolderRefNode update or reconcile
~~~

## Wikilinks

~~~text
CodeMirror wikilink autocomplete/decorations
  -> features/links.searchLinkIndex() or resolveWikilink()
  -> ipc::commands::links/*
  -> LinkRepository query against metadata link_index

User follows [[Note#Heading]] or [[Note#^block]]
  -> parseWikilink()
  -> resolveAndNavigate()
  -> uiStore/editorStore select candidate
  -> editorStore.navigateTo(fragment)
  -> Editor navigateToFragment()
~~~

## Archive import/export

~~~text
App picker
  -> ArchiveWorkflow and operation lease
  -> check_zip_conflicts() when importing ZIP
  -> explicit overwrite/rename/skip resolutions
  -> archive repository preflight + staging
  -> collection/import_transaction journal
  -> owned publish/backup/rollback or recoverable blocking state
  -> save collection metadata and open the new collection
~~~

Folder and ZIP export use the same staged publication and safe replacement rules; existing outputs are not deleted before a replacement is ready.

## Settings and fonts

~~~text
App.onMount()
  -> features/settings.loadSettings()
  -> applyThemeSettings() to CSS custom properties
  -> getFontsDir()
  -> registerCustomFonts() using platform.convertFileSrc()

ThemePanel change
  -> applyThemeSettings()
  -> saveSettings() -> settings.json

Font import/delete or theme import/export
  -> SettingsWorkflow operation lease
  -> features/settings IPC adapter
  -> AppSettingsRepository + font_manager/theme_io
~~~

The current dialog gateways use JSON theme files. The README description of YAML is not the source of truth for this behavior.

## Window close

~~~text
Tauri close request
  -> createAppCloseTransactionHandler()
  -> operationLeaseRegistry.waitForIdle()
  -> editorStore.closeFile()/flushPendingSave()
  -> destroy only after a successful conditional save
  -> retain draft and keep window open on save failure
~~~

# Important Dependencies

## Runtime data

- Collection JSON compatibility files live under the application collections directory.
- metadata-v1.sqlite stores normalized collection metadata, revisions, changes, mutation records, migration state, and the current link index.
- metadata-v1.state records the published metadata mode and source/target digests.
- link-index.db is the legacy link-index path retained for compatibility/migration code.
- settings.json stores persisted theme, typography, colors, and custom-font metadata.
- Custom font files live under the application data fonts directory.
- .collectives-transactions/v1 contains owned collection archive transaction journals.
- .collectives-metadata/migrations/v1 contains owned metadata migration journals.

## IPC contract

The ordinary IPC contract covers collection CRUD, settings, folder reads, document reads/writes, wikilink search, archive operations, font/theme operations, watcher operations, and file identity operations. The metadata/transition contract adds revisioned mutations, migration status/retry, watcher synchronization, collection snapshots, and folder-reference snapshots.

All frontend command calls should go through shared/ipc/client.ts or a feature/platform gateway. All backend command registration should come from the generated registry rather than a hand-maintained handler list.

## Verification commands

The repository defines:

- npm run typecheck
- npm run lint
- npm run test -- --run
- npm run build
- node scripts/phase0/verify-quality.mjs frontend
- node scripts/phase0/verify-quality.mjs backend
- node scripts/ipc/generate-contracts.mjs --check
- node scripts/ipc/verify-handler-registry.mjs
- node scripts/ipc/check-boundaries.mjs
- node scripts/phase4/check-design-contract.mjs --check
- cargo fmt --all -- --check
- cargo clippy --locked --all-targets -- -D warnings
- cargo test --locked --all-targets

Phase evidence and rebuild reports under docs/rebuild describe the validated scope and known runner limitations. They are evidence, not a replacement for the current source or contracts.

# Notes

- The current HEAD is b19023a57ea000d56c7d7000b5607287d49d6b4e; the working tree contains additional uncommitted source, contract, test, script, and documentation changes captured by this review.
- src-tauri/src/commands.rs is a compatibility shim that re-exports application services; it is not the active generated command registration path.
- src/lib/tauri.ts is a compatibility re-export facade; new production code should use feature indexes, shared IPC, and platform gateways.
- Generated files under src/shared/ipc/generated.ts, src-tauri/src/ipc/generated.rs, src/shared/fileCapabilities.generated.ts, and src-tauri/src/file_capabilities_generated.rs should be changed through their source manifests/generator scripts.
- The source currently preserves both ordinary CRUD IPC and revisioned metadata v2 protocols. When changing collection mutation behavior, inspect both collection reload paths and metadata cache/event continuity.
- When changing document selection or close behavior, preserve editor generation/revision checks, pending-selection semantics, conditional version tokens, and operation-lease waiting.
- When changing folder-reference behavior, preserve root containment/reparse validation, readiness generations, retry classification, watcher cursor matching, and cancellation.
- Historical reasoning belongs in decisions.md; this file records the current structure and runtime behavior.
- Follow-up inspection (2026-09-22): reload-and-discard reads the external snapshot without enqueuing the draft, retains drafts on read failure, and rejects stale reload results. Editor synchronizes same-path snapshots and reconfigures its base parser when file kind changes. Text-source view mode is read-only. Pending modal workflows block Escape/backdrop dismissal and duplicate keyboard submission. Metadata cache cycle detection uses an explicit visited-set membership check and falls back to a snapshot on cyclic parents. The watch synchronization command accepts the contract's collectionId argument via collection_id.
