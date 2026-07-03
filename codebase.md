# Codebase - Collectives
> Last updated: 2026-06-30 16:08  
> Stack: SolidJS + TypeScript + CodeMirror 6 frontend, Tauri v2 + Rust backend

## Overview
Collectives is a local-first Markdown knowledge management app. The frontend owns the workspace UI, editor experience, theme controls, and state stores, while the Rust/Tauri backend persists collection manifests, reads/writes local files, indexes wiki links, imports/exports archives, manages fonts/themes, and watches filesystem changes.

This project is not a Unity project; this map adapts the `codebase.md` convention to the actual TypeScript/Rust codebase.

---

## App Shell (`src/`)

### App - `src/App.tsx`
**Type**: Solid component  
**Description**: Main application shell. It loads collections/settings on mount, restores the previous collection/selection, wires sidebar actions to dialogs, synchronizes selected entries into the editor store, and renders global error/notice UI.

**State**
| Name | Type | Notes |
|------|------|-------|
| `isNewCollectionOpen` | `Accessor<boolean>` | Controls the create collection dialog |
| `newCollectionError` | `Accessor<string>` | Validation/backend error for creating collections |
| `appNotice` | `Accessor<{ title: string; message: string } \| null>` | User-visible transient error notice for import failures |
| `isSettingsOpen` | `Accessor<boolean>` | Controls the theme/settings panel |
| `settings` | `Accessor<Settings>` | Loaded app theme/font settings |
| `globalError` | `Accessor<{ message: string; stack?: string } \| null>` | Captures unhandled browser errors/rejections |
| `importFolderPath`, `isImportFolderNameOpen`, `importFolderNameError` | signals | Folder import flow |
| `zipFilePath`, `zipDestFolder`, `zipConflicts`, `isZipConflictOpen` | signals | ZIP import/conflict-resolution flow |

**Methods**
| Signature | Description |
|-----------|-------------|
| `onMount(async () => ...)` | Registers global error handlers, close-save behavior, loads collections/settings/fonts, restores previous selection, and initializes filesystem event listeners |
| `showAppNotice(title, err)` | Converts failures into visible notice copy |
| `handleImportFolderClick()` | Opens a directory picker and then asks for imported collection name |
| `handleImportFolderConfirm(name?)` | Imports a chosen folder as a collection |
| `handleImportZipClick()` | Picks a ZIP and destination folder, then checks/imports conflicts |
| `handleZipConflictConfirm(resolutions)` | Completes ZIP import using user-selected conflict resolutions |
| `createEffect(selection -> editor)` | Opens, reloads, or closes editor content when sidebar selection changes |
| `handleCreateCollection(name?)` | Creates and opens a new collection |
| `getSelectedEntryInfo()` | Resolves selected manifest entry or lazy folder-ref child into display/editor metadata |

### index - `src/index.tsx`
**Type**: entry module  
**Description**: Mounts the Solid app into the DOM.

---

## Stores (`src/stores/`)

### collectionsStore - `src/stores/collections.ts`
**Type**: Solid store singleton  
**Description**: Owns collection list state, active collection selection, broken-entry detection, manifest mutations, import/export operations, and Tauri filesystem event listeners.

**State**
| Name | Type | Notes |
|------|------|-------|
| `collections` | `Collection[]` | All known collection manifests |
| `activeCollectionId` | `string \| null` | Current collection, persisted to `localStorage` |
| `loading` | `boolean` | Load status |
| `error` | `string \| null` | Last store-level failure |
| `brokenEntries` | `BrokenEntry[]` | Files/folders that failed validation |
| `movePrompt` | object \| null | Prompt data when identity tracking detects a moved entry |

**Methods**
| Signature | Description |
|-----------|-------------|
| `activeCollection()` | Memoized current collection lookup |
| `loadCollections()` | Loads manifests from backend |
| `openCollection(id)` | Selects collection, clears UI/editor selection, initializes identity cache/watchers, validates entries |
| `createCollection(name)` / `renameCollection(id, newName)` / `deleteCollection(id)` | Collection lifecycle operations with duplicate-name checks |
| `addFiles(paths)` / `addFolderRef(path)` | Adds file entries or live folder references |
| `createGroup(name, parentPath)` / `renameGroup(groupId, newName)` | Creates or renames virtual groups |
| `removeEntry(entryId)` / `moveEntry(entryId, newParentPath, newIndex)` | Mutates collection tree and refreshes validation/watchers |
| `relinkEntry(entryId, newPath)` | Updates a file/folder-ref path after manual relink or watcher rename |
| `watchActiveCollection()` | Registers backend watches for files and expanded folder refs |
| `validateActiveCollection()` | Calls backend validation and triggers moved-file detection |
| `reloadActiveCollection()` | Reloads manifests and clears wikilink cache |
| `importFolder(path, name)` / `importZip(zipPath, destFolder, resolutions)` | Imports external data as a collection |
| `exportCollectionToFolder(collectionId, destPath)` / `exportCollectionToZip(collectionId, destZipPath)` | Exports active data |
| `initializeListeners()` | Listens for `file-modified`, `entry-deleted`, `entry-renamed`, and `folder-changed` Tauri events |

### editorStore - `src/stores/editor.ts`
**Type**: Solid store singleton  
**Description**: Tracks the open Markdown file, current editor contents, dirty/saving state, read-only state, editor mode, load/save errors, and pending wikilink fragment navigation.

**Methods**
| Signature | Description |
|-----------|-------------|
| `openFile(path, readOnly = false)` | Auto-saves previous dirty file, reads the next file, and resets editor state |
| `saveFile()` | Writes current content through Tauri when dirty and writable |
| `updateContent(content)` | Updates current content and dirty flag |
| `setMode(mode)` | Switches between `view`, `edit-render`, and `edit-source` |
| `closeFile()` | Clears editor state and sidebar selection |
| `navigateTo(fragment)` / `clearPendingNavigation()` | Drives delayed scroll-to-heading/block behavior |
| `currentFileName` | Getter for display name without `.md` |

### uiStore - `src/stores/ui.ts`
**Type**: Solid store singleton  
**Description**: Tracks expanded tree nodes, selected entry, sidebar open state, and persisted sidebar width.

---

## UI Components (`src/components/`)

### Sidebar - `src/components/sidebar/Sidebar.tsx`
**Type**: Solid component  
**Description**: Left navigation panel. It exposes collection selection, active collection actions, tree rendering, sidebar resizing, and root group creation.

**Methods**
| Signature | Description |
|-----------|-------------|
| `handleAddFiles()` | Picks Markdown files and adds them to active collection |
| `handleAddFolderRef()` | Picks a directory and adds it as a live folder reference |
| `handleCreateRootGroup(name?)` | Creates a top-level virtual group |
| resize handlers | Maintain `--sidebar-width` and persist width through `uiStore` |

### CollectionItem - `src/components/sidebar/CollectionItem.tsx`
**Type**: Solid component  
**Description**: Represents one collection in collection lists/context menus, including rename/delete/export actions.

### CollectionList - `src/components/sidebar/CollectionList.tsx`
**Type**: Solid component  
**Description**: Legacy/simple collection list component that loads and renders `CollectionItem` rows.

### TreeNode - `src/components/tree/TreeNode.tsx`
**Type**: Solid dispatcher component  
**Description**: Delegates an `Entry` union to `FileNode`, `FolderRefNode`, or `GroupNode`.

### FileNode - `src/components/tree/FileNode.tsx`
**Type**: Solid component  
**Description**: Renders a manifest file entry, selection behavior, broken-file relink, removal, and move-to-group dialog.

### FolderRefNode - `src/components/tree/FolderRefNode.tsx`
**Type**: Solid component  
**Description**: Renders a referenced filesystem folder. It lazy-loads directory contents, registers folder watches when expanded, supports relink/remove/move actions, and recursively renders child filesystem nodes.

### GroupNode - `src/components/tree/GroupNode.tsx`
**Type**: Solid component  
**Description**: Renders a virtual group, nested entries, context menu actions, subgroup creation, rename, move, and delete-with-child-promotion behavior.

### Editor - `src/components/editor/Editor.tsx`
**Type**: Solid component  
**Description**: Owns the CodeMirror `EditorView`, mode reconfiguration, content synchronization, autosave timers, resize measurement, Ctrl/Cmd+S, and pending wikilink navigation.

**Methods**
| Signature | Description |
|-----------|-------------|
| `onMount()` | Creates CodeMirror editor with base extensions and current mode extensions |
| `onCleanup()` | Destroys editor, clears timers, and saves dirty writable content |
| `createEffect(mode)` | Reconfigures CodeMirror mode compartment |
| `createEffect(openFilePath)` | Replaces editor document when the store opens a new file |
| `createEffect(autosave)` | Debounces autosave after 2s idle and force-saves after 15s |
| `createEffect(pendingNavigation)` | Scrolls to heading/block refs after wikilink navigation |

### EditorToolbar - `src/components/editor/EditorToolbar.tsx`
**Type**: Solid component  
**Description**: Displays current file, save status indicator, read-only badge, and editor mode segmented control.

### ThemePanel - `src/components/theme/ThemePanel.tsx`
**Type**: Solid component  
**Description**: Settings panel for theme mode, fonts, font import/delete, typography sizes, colors, line height, and theme import/export.

### Dialog - `src/components/common/Dialog.tsx`
**Type**: Solid component  
**Description**: Shared modal for confirm and text-input flows. Handles Enter/Escape, autofocus, errors, and custom body children.

### ContextMenu - `src/components/common/ContextMenu.tsx`
**Type**: Solid component  
**Description**: Shared fixed-position context menu for tree and collection actions.

### Icon - `src/components/common/Icon.tsx`
**Type**: Solid component  
**Description**: Inline SVG icon set used across buttons, tree rows, dialogs, and status UI.

### ZipConflictDialog - `src/components/common/ZipConflictDialog.tsx`
**Type**: Solid component  
**Description**: Presents ZIP import conflicts and collects per-entry overwrite/rename/skip resolutions.

---

## Frontend Libraries (`src/lib/`)

### tauri API bridge - `src/lib/tauri.ts`
**Type**: API wrapper module  
**Description**: Strongly typed frontend wrappers around Tauri `invoke` commands and dialog helpers. This is the boundary for collection CRUD, file I/O, link search, import/export, font/theme operations, watcher control, and identity cache operations.

### themeEngine - `src/lib/themeEngine.ts`
**Type**: utility module  
**Description**: Applies `Settings` to CSS custom properties, switches explicit/system theme behavior, registers custom `@font-face` rules, and exposes default values for the settings UI.

### editorMeasure - `src/lib/editorMeasure.ts`
**Type**: utility module  
**Description**: Small pub/sub helper for requesting CodeMirror layout measurement after theme/font changes.

### wikilink parser/resolver - `src/lib/wikilink/`
**Type**: utility modules  
**Description**: Parses `[[Note#Fragment]]` syntax, serializes tokens, resolves note names through the active collection index, selects resolved entries, and scrolls to headings or block IDs.

### CodeMirror extensions - `src/lib/cm-extensions/`
**Type**: extension modules  
**Description**: CodeMirror feature layer for Markdown mode selection, live render decorations, formatting keymaps, delimiter pairs, wikilink autocomplete/decorations, block refs, annotations, tables, charts, code block widgets, syntax highlighting, and empty-state widgets.

Key exports:
| File | Responsibility |
|------|----------------|
| `markdown-mode.ts` | Composes base editor extensions and mode-specific extension sets |
| `render-decorations.ts` | Adds live Markdown styling in render edit mode |
| `formatting-keymap.ts` / `formatting-utils.ts` | Toggles markdown formatting, list indentation, and stable Alt+Arrow line movement |
| `wikilink-autocomplete.ts` / `wikilink-decoration.ts` | Suggests and validates wiki links |
| `block-ref.ts` | Generates/copies block IDs and renders block refs |
| `table-widget.ts` | Renders Markdown tables as interactive widgets |
| `chart-widget.ts` | Renders YAML `chart` fenced blocks through Chart.js |
| `code-block-widget.ts` / `syntax-highlight.ts` | Renders fenced code blocks with highlighted preview |

---

## Types (`src/types/index.ts`)

### Collection / Entry / Settings types
**Type**: TypeScript type module  
**Description**: Shared frontend contracts for collection manifests, entries, filesystem entries, broken entries, theme/font settings, editor modes, wikilink tokens/fragments, link resolution candidates, and ZIP conflicts.

Important unions:
| Name | Shape |
|------|-------|
| `Entry` | `{ type: "file"; id; path }` or `{ type: "folder-ref"; id; path }` or `{ type: "group"; id; name; children }` |
| `EditorMode` | `"view" \| "edit-source" \| "edit-render"` |

---

## Backend (`src-tauri/src/`)

### lib - `src-tauri/src/lib.rs`
**Type**: Tauri bootstrap module  
**Description**: Registers plugins, initializes watcher and file-identity managed state, and exposes all command handlers to the frontend.

### commands - `src-tauri/src/commands.rs`
**Type**: Tauri command module  
**Description**: IPC surface for frontend calls. It delegates persistence to collection/settings/theme/font/link/fs modules and updates the link index after collection mutations.

**Command groups**
| Group | Commands |
|-------|----------|
| Collections | `get_collections`, `create_collection`, `update_collection`, `delete_collection` |
| Entries/groups | `add_entry`, `remove_entry`, `move_entry`, `create_group`, `rename_group`, `add_file_entries`, `add_folder_ref`, `validate_entries` |
| Files | `read_folder_children`, `read_file`, `write_file` |
| Wikilinks | `resolve_wikilink`, `search_link_index` |
| Import/export | `import_folder`, `export_collection_to_folder`, `export_collection_to_zip`, `check_zip_conflicts`, `import_zip` |
| Settings/theme/font | `load_settings`, `save_settings`, `import_font`, `delete_font`, `get_fonts_dir`, `export_theme`, `import_theme` |

### collection model/manager/archive - `src-tauri/src/collection/`
**Type**: Rust modules  
**Description**: Defines collection manifest structures, stores manifests in app data, mutates nested entry trees, validates names, imports folders, exports folders/ZIPs, detects ZIP conflicts, and extracts ZIP assets.

Key files:
| File | Responsibility |
|------|----------------|
| `model.rs` | `Entry`, `CollectionMetadata`, and `Collection` serde models |
| `manager.rs` | Load/save/delete/get collection manifests and nested entry mutations |
| `archive.rs` | Import/export folders and ZIP archives with conflict handling |

### fs_ops - `src-tauri/src/fs_ops.rs`
**Type**: Rust utility module  
**Description**: Normalizes paths and reads directory children as `FsEntry` values for folder-ref browsing.

### fs_layer - `src-tauri/src/fs_layer/`
**Type**: Rust modules  
**Description**: Filesystem watching and identity tracking. `watcher.rs` emits Tauri events for file modifications/deletions/renames and folder changes. `file_identity.rs` caches platform file IDs and detects moved entries.

### link_index - `src-tauri/src/link_index.rs`
**Type**: Rust SQLite index module  
**Description**: Maintains a searchable index of collection entries for wikilink resolution and autocomplete.

### settings - `src-tauri/src/settings.rs`
**Type**: Rust settings module  
**Description**: Loads and saves app settings, including theme mode, typography, colors, line height, and custom font metadata.

### font_manager - `src-tauri/src/font_manager.rs`
**Type**: Rust utility module  
**Description**: Imports font files into app data, records family/weight/style metadata, and deletes custom font files.

### theme_io - `src-tauri/src/theme_io.rs`
**Type**: Rust utility module  
**Description**: Exports/imports theme settings and related font assets.

---

## Code Flow

### Startup and Restore
```text
App.onMount()
  -> collectionsStore.loadCollections()
       -> api.getCollections()
            -> commands::get_collections()
  -> read lastActiveCollectionId / lastSelectedEntryId from localStorage
  -> collectionsStore.openCollection(lastActiveId)
       -> api.initializeIdentityCache()
       -> collectionsStore.watchActiveCollection()
       -> collectionsStore.validateActiveCollection()
  -> api.loadSettings()
  -> applyThemeSettings(settings)
  -> api.getFontsDir()
  -> registerCustomFonts(settings.customFonts, fontsDir)
  -> collectionsStore.initializeListeners()
```

### Opening and Editing a Note
```text
Tree node click
  -> uiStore.selectEntry(entryId or filesystem path)
  -> App selection effect
       -> getSelectedEntryInfo()
       -> editorStore.openFile(path)
            -> api.readFile(path)
            -> commands::read_file()
  -> Editor openFilePath effect replaces CodeMirror doc
  -> CodeMirror updateListener
       -> editorStore.updateContent(doc)
  -> Editor autosave effect
       -> editorStore.saveFile()
            -> api.writeFile(path, content)
            -> commands::write_file()
```

### Collection Tree Mutations
```text
Sidebar/FileNode/FolderRefNode/GroupNode action
  -> collectionsStore method
       -> api.* wrapper
            -> commands::* Tauri command
                 -> collection::manager mutation
                 -> link_index::update_index_for_collection()
       -> collectionsStore.reloadActiveCollection()
       -> collectionsStore.validateActiveCollection()
       -> collectionsStore.watchActiveCollection()
```

### Folder Reference Browsing
```text
FolderRefNode toggle expand
  -> uiStore.toggleExpand(folderRefId)
  -> api.watchFolder(path, entryId)
  -> readFolderChildren(path)
       -> commands::read_folder_children()
            -> fs_ops::read_children()
  -> render FsNode children recursively
```

### Filesystem Events
```text
fs_layer::watcher detects change
  -> emits Tauri event
  -> collectionsStore.initializeListeners()
       file-modified/folder-changed:
         if open file is clean -> editorStore.openFile(path) and restore mode
       entry-deleted:
         add BrokenEntry
       entry-renamed:
         collectionsStore.relinkEntry(entryId, newPath)
```

### Wikilinks
```text
CodeMirror wikilink autocomplete/decoration
  -> api.searchLinkIndex() / api.resolveWikilink()
       -> commands::search_link_index() / resolve_wikilink()
            -> link_index SQLite lookup

User follows wikilink
  -> resolveAndNavigate()
       -> uiStore.selectEntry(candidate.entryId or path)
       -> editorStore.navigateTo(fragment)
  -> Editor pendingNavigation effect
       -> navigateToFragment(view, fragment)
```

### Theme and Fonts
```text
ThemePanel changes settings
  -> applyThemeSettings(settings)
       -> document.documentElement CSS variables
       -> requestEditorMeasure()
  -> api.saveSettings(settings)
       -> commands::save_settings()

Custom font import
  -> api.pickFontFile()
  -> api.importFont()
       -> font_manager::import_font()
  -> registerCustomFonts()
```

### Import and Export
```text
Welcome/sidebar action
  -> App.handleImportFolderClick() or handleImportZipClick()
  -> dialog/picker flow
  -> collectionsStore.importFolder() or importZip()
       -> commands::import_folder() / import_zip()
            -> collection::archive
       -> collectionsStore.openCollection(newCollection.id)

Collection context menu export
  -> CollectionItem.handleExportToFolder() or handleExportToZip()
  -> collectionsStore export method
       -> commands::export_collection_to_folder() / export_collection_to_zip()
```

---

## Event & Delegate Flow

| Event / Signal | Type | Fired By | Consumed By | When |
|----------------|------|----------|-------------|------|
| `file-modified` | Tauri event | `fs_layer::watcher` | `collectionsStore.initializeListeners()` | Watched file changes on disk |
| `entry-deleted` | Tauri event | `fs_layer::watcher` | `collectionsStore.initializeListeners()` | Watched entry disappears |
| `entry-renamed` | Tauri event | `fs_layer::watcher` | `collectionsStore.initializeListeners()` | Watched entry path changes |
| `folder-changed` | Tauri event | `fs_layer::watcher` | `FolderRefNode`, `collectionsStore.initializeListeners()` | Expanded folder-ref content changes |
| CodeMirror `updateListener` | Editor extension callback | `Editor` | `editorStore.updateContent()` | Editor document changes |
| `pendingNavigation` | Store state | Wikilink resolver | `Editor` | Navigate to heading/block after file selection |

---

## Data Flow

| Data | Source | Flows To | When |
|------|--------|----------|------|
| Collection manifests | App data JSON via `collection::manager` | `collectionsStore`, sidebar/tree, link index | Startup and collection mutations |
| Markdown file contents | Local filesystem via `commands::read_file` | `editorStore`, CodeMirror | Selecting file/folder-ref child |
| Edited Markdown | CodeMirror document | `editorStore.saveFile()` -> `commands::write_file` | Autosave, Ctrl/Cmd+S, close, file switch |
| Link index | SQLite via `link_index` | Wikilink autocomplete/resolution | After collection mutations and user link search |
| Settings | App data settings file via `settings.rs` | `ThemePanel`, `themeEngine` | Startup and settings changes |
| Custom fonts | App data font directory | `themeEngine.registerCustomFonts()` | Startup and font import/delete |
| Filesystem watch state | `fs_layer::watcher::WatchManager` | Tauri event listeners | Active collection/folder expansion changes |
| File identity cache | `fs_layer::file_identity::FileIdentityCache` | Move detection prompt | Opening/validating active collection |

---

## Verification Notes
`npm.cmd run typecheck` passes on 2026-06-30. Running `npm run typecheck` directly in PowerShell failed because this machine blocks `npm.ps1` scripts via execution policy.
