import { createSignal, onCleanup, Show, For, onMount, createEffect, on } from "solid-js";
import { collectionsStore } from "../../stores/collections";
import { uiStore } from "../../stores/ui";
import { Icon } from "../common/Icon";
import { TreeNode } from "../tree/TreeNode";
import { Dialog } from "../common/Dialog";
import { pickFiles, pickDirectory } from "../../platform";
import { installTreeKeyboardModel } from "../tree/treeAccessibility";
import { asSafetyError, formatIpcError } from "../../shared/ipc/errors";
import "./Sidebar.css";

interface SidebarProps {
  onNewNoteClick: () => void;
  onQuickOpen?: () => void;
  onContentSearch?: () => void;
  onNewCollectionClick: () => void;
  onImportFolderClick: () => void;
  onImportZipClick: () => void;
  onSettingsClick: () => void;
  requestSelect: (entryId: string | null) => Promise<boolean>;
  requestFolderRefSelect: (intent: import("../../features/filesystem/folderRefReadiness").FolderRefIntentInput) => Promise<boolean>;
  requestSwitch: (collectionId: string) => Promise<boolean>;
  onReviewMovePrompt: () => void;
  recoveryDraftCount: number;
  onReviewRecovery: () => void;
  operationLeaseRegistry?: import("../../workflows/operationLease").OperationLeaseRegistry;
}

export function Sidebar(props: SidebarProps) {
  const [isDropdownOpen, setIsDropdownOpen] = createSignal(false);
  const [isResizing, setIsResizing] = createSignal(false);
  const [isNewGroupOpen, setIsNewGroupOpen] = createSignal(false);
  const [newGroupError, setNewGroupError] = createSignal("");
  const [renameId, setRenameId] = createSignal<string | null>(null);
  const [renameValue, setRenameValue] = createSignal("");
  const [renameError, setRenameError] = createSignal("");
  const [renamePending, setRenamePending] = createSignal(false);
  let renameInput: HTMLInputElement | undefined;
  const startRenameCollection = () => {
    const collection = collectionsStore.activeCollection();
    if (!collection) return;
    setRenameId(collection.id);
    setRenameValue(collection.name);
    setRenameError("");
    queueMicrotask(() => { renameInput?.focus(); renameInput?.select(); });
  };
  const cancelRenameCollection = () => {
    if (renamePending()) return;
    setRenameId(null);
    setRenameError("");
    collectionPickerRef?.focus();
  };
  const saveCollectionName = async (event: SubmitEvent) => {
    event.preventDefault();
    const id = renameId();
    const name = renameValue().trim();
    if (!id || renamePending()) return;
    if (!name) { setRenameError("Enter a collection name."); renameInput?.focus(); return; }
    setRenamePending(true);
    setRenameError("");
    try {
      await collectionsStore.renameCollection(id, name);
      setRenameId(null);
      collectionPickerRef?.focus();
    } catch (error) {
      setRenameError(formatIpcError(error));
    } finally { setRenamePending(false); }
  };
  const [actionError, setActionError] = createSignal<{ title: string; message: string; details: string } | null>(null);
  let dropdownRef: HTMLDivElement | undefined;
  let collectionPickerRef: HTMLButtonElement | undefined;
  let treeRoot: HTMLDivElement | undefined;
  let sidebarRef: HTMLElement | undefined;
  let disposeTreeKeyboardModel: (() => void) | undefined;

  // Set the CSS variable on mount based on store state
  onMount(() => {
    document.documentElement.style.setProperty("--sidebar-width", `${uiStore.state.sidebarWidth}px`);
    if (treeRoot) disposeTreeKeyboardModel = installTreeKeyboardModel(treeRoot);
  });

  const focusCollectionOption = (index: number) => {
    const options = dropdownRef ? Array.from(dropdownRef.querySelectorAll<HTMLButtonElement>('[role="option"]')) : [];
    if (options.length === 0) return;
    const next = Math.min(Math.max(index, 0), options.length - 1);
    options[next]?.focus();
  };

  const handleCollectionPickerKeyDown = (event: KeyboardEvent) => {
    const options = dropdownRef ? Array.from(dropdownRef.querySelectorAll<HTMLButtonElement>('[role="option"]')) : [];
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setIsDropdownOpen(true);
      queueMicrotask(() => focusCollectionOption(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : event.key === "ArrowDown" ? 0 : Math.max(options.length - 1, 0)));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setIsDropdownOpen((open) => !open);
      if (!isDropdownOpen()) queueMicrotask(() => focusCollectionOption(Math.max(collectionsStore.state.collections.findIndex((collection) => collection.id === collectionsStore.state.activeCollectionId), 0)));
    }
  };

  const handleCollectionOptionKeyDown = (event: KeyboardEvent, index: number) => {
    const options = dropdownRef ? Array.from(dropdownRef.querySelectorAll<HTMLButtonElement>('[role="option"]')) : [];
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : event.key === "ArrowDown" ? Math.min(index + 1, options.length - 1) : Math.max(index - 1, 0);
      focusCollectionOption(next);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setIsDropdownOpen(false);
      collectionPickerRef?.focus();
      return;
    }
    if (event.key === "Tab") {
      setIsDropdownOpen(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const collection = collectionsStore.state.collections[index];
      if (!collection) return;
      void props.requestSwitch(collection.id);
      setIsDropdownOpen(false);
      collectionPickerRef?.focus();
    }
  };

  const handleDocumentClick = (e: MouseEvent) => {
    if (dropdownRef && !e.composedPath().includes(dropdownRef)) {
      setIsDropdownOpen(false);
    }
  };

  document.addEventListener("click", handleDocumentClick);

  // Resizing logic
  const handleMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    let newWidth = e.clientX - (sidebarRef?.getBoundingClientRect().left ?? 0);
    if (newWidth < 180) newWidth = 180;
    if (newWidth > 480) newWidth = 480;
    document.documentElement.style.setProperty("--sidebar-width", `${newWidth}px`);
  };

  const handleMouseUp = (e: MouseEvent) => {
    setIsResizing(false);
    let newWidth = e.clientX - (sidebarRef?.getBoundingClientRect().left ?? 0);
    if (newWidth < 180) newWidth = 180;
    if (newWidth > 480) newWidth = 480;
    uiStore.setSidebarWidth(newWidth);
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  };

  onCleanup(() => {
    disposeTreeKeyboardModel?.();
    document.removeEventListener("click", handleDocumentClick);
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  });

  // Active Collection action triggers
  const handleAddFiles = async () => {
    setActionError(null);
    try {
      const selected = await pickFiles("Select Markdown Notes");
      if (selected && selected.length > 0) {
        await collectionsStore.addFiles(selected);
      }
    } catch (err) {
      console.error("Failed to pick files", err);
      setActionError({ title: "Could not add files", message: asSafetyError(err)?.message || "Check that the files are available, then try again.", details: formatIpcError(err) });
    }
  };

  const handleAddFolderRef = async () => {
    setActionError(null);
    try {
      const selected = await pickDirectory("Select Folder to Reference");
      if (selected) {
        await collectionsStore.addFolderRef(selected);
      }
    } catch (err) {
      console.error("Failed to pick directory", err);
      setActionError({ title: "Could not add folder", message: asSafetyError(err)?.message || "Check that the folder is available, then try again.", details: formatIpcError(err) });
    }
  };

  const handleCreateRootGroup = async (name?: string) => {
    if (!name) {
      setNewGroupError("Group name cannot be empty");
      return;
    }
    try {
      await collectionsStore.createGroup(name, []);
      setIsNewGroupOpen(false);
      setNewGroupError("");
    } catch (err) {
      setNewGroupError(err instanceof Error ? err.message : String(err));
    }
  };

  const activeCol = () => collectionsStore.activeCollection();

  createEffect(on(isDropdownOpen, (open) => {
    if (!open && !renamePending()) { setRenameId(null); setRenameError(""); }
  }));

  const collectionSwitcher = () => (
    <div class="sidebar-actions-container sidebar-top-picker" ref={dropdownRef}>
      <button
        ref={collectionPickerRef}
        type="button"
        class="vault-info sidebar-title-selector"
        onClick={(event) => {
          event.stopPropagation();
          setIsDropdownOpen(!isDropdownOpen());
        }}
        title="Switch or manage collections"
        aria-label="Choose collection"
        aria-haspopup="listbox"
        aria-expanded={isDropdownOpen() ? "true" : "false"}
        aria-controls="collection-picker-listbox"
        onKeyDown={handleCollectionPickerKeyDown}
      >
        <Icon name="folder" size={14} class="vault-icon" />
        <span class="collection-picker-copy"><small>Collection</small><span class="active-col-name">{activeCol()?.name || "Choose a collection"}</span></span>
        <Icon name="chevron-down" size={12} style={{ opacity: 0.6 }} />
      </button>
      <Show when={isDropdownOpen()}>
        <div class="sidebar-dropdown">
          <span class="dropdown-header">Collections</span>
          <div id="collection-picker-listbox" role="listbox" aria-label="Collections">
            <For each={collectionsStore.state.collections}>
              {(collection, index) => (
                <button
                  class="dropdown-item"
                  classList={{ active: activeCol()?.id === collection.id }}
                  type="button"
                  role="option"
                  aria-selected={activeCol()?.id === collection.id ? "true" : "false"}
                  onKeyDown={(event) => handleCollectionOptionKeyDown(event, index())}
                  onClick={() => {
                    void props.requestSwitch(collection.id);
                    setIsDropdownOpen(false);
                  }}
                >
                  <Icon name="folder" size={14} />
                  <span class="dropdown-item-text">{collection.name}</span>
                </button>
              )}
            </For>
          </div>
          <div class="dropdown-divider" />
          <Show when={activeCol()}>
            <Show when={renameId()} fallback={<button class="dropdown-item" type="button" onClick={event => { event.stopPropagation(); startRenameCollection(); }}><Icon name="edit" size={14} /><span>Rename collection</span></button>}>
              <form class="collection-rename-form" onSubmit={saveCollectionName} aria-label="Rename collection" aria-busy={renamePending()}>
                <label for="collection-rename-input">Collection name</label>
                <input ref={renameInput} id="collection-rename-input" value={renameValue()} disabled={renamePending()} onInput={event => setRenameValue(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelRenameCollection(); } }} />
                <Show when={renameError()}><p role="alert">{renameError()}</p></Show>
                <div><button class="btn btn-text" type="button" disabled={renamePending()} onClick={cancelRenameCollection}>Cancel</button><button class="btn btn-primary" type="submit" disabled={renamePending()}>{renamePending() ? "Saving…" : "Save name"}</button></div>
              </form>
            </Show>
            <div class="dropdown-divider" />
          </Show>
          <button class="dropdown-item" type="button" aria-label="New Collection" onClick={() => { props.onNewCollectionClick(); setIsDropdownOpen(false); }}>
            <Icon name="plus" size={14} /><span>New Collection</span>
          </button>
          <button class="dropdown-item" type="button" aria-label="Import Local Folder" onClick={() => { props.onImportFolderClick(); setIsDropdownOpen(false); }}>
            <Icon name="folder-plus" size={14} /><span>Import Local Folder</span>
          </button>
          <button class="dropdown-item" type="button" aria-label="Import ZIP Archive" onClick={() => { props.onImportZipClick(); setIsDropdownOpen(false); }}>
            <Icon name="file" size={14} /><span>Import ZIP Archive</span>
          </button>
        </div>
      </Show>
    </div>
  );

  return (
    <aside
      ref={sidebarRef}
      aria-label="Collection navigation"
      class={`sidebar ${!uiStore.state.isSidebarOpen ? "collapsed" : ""} ${isResizing() ? "resizing" : ""}`}
    >
      {/* Header with App Brand and toggle button */}
      <div class="sidebar-header">
        <span class="app-brand"><span class="app-brand-mark" aria-hidden="true"><Icon name="virtual-folder" size={17} /></span>Collectives</span>
        <button
          class="btn btn-text btn-icon sidebar-toggle-btn"
          onClick={() => uiStore.toggleSidebar()}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
        >
          <Icon name="menu" size={16} />
        </button>
      </div>

      <Show when={props.recoveryDraftCount > 0}>
        <div class="sidebar-move-reminder" role="status">
          <span>{props.recoveryDraftCount} recovered draft{props.recoveryDraftCount === 1 ? "" : "s"} need review.</span>
          <button class="btn btn-text" onClick={() => props.onReviewRecovery()}>Review</button>
        </div>
      </Show>

      {collectionSwitcher()}

      <Show when={activeCol()}>
        <div class="sidebar-primary-actions">
          <Show when={props.onQuickOpen}>
            <button type="button" class="sidebar-search" onClick={() => props.onQuickOpen?.()} aria-label="Quick Open">
              <Icon name="search" size={16} /><span>Find a note…</span><kbd>Ctrl P</kbd>
            </button>
          </Show>
          <button class="btn btn-primary sidebar-new-note" onClick={() => props.onNewNoteClick()}>
            <Icon name="plus" size={16} /><span>New note</span><kbd>Ctrl N</kbd>
          </button>
          <Show when={props.onContentSearch}>
            <button type="button" class="sidebar-content-search" onClick={() => props.onContentSearch?.()} aria-label="Search note contents">
              <Icon name="search" size={14} /><span>Search in notes</span><span class="sidebar-search-shortcut">Ctrl Shift F</span>
            </button>
          </Show>
        </div>
      </Show>

      {/* Main content area */}
      <div class="sidebar-content">
        <Show
          when={activeCol()}
          fallback={
            <div class="sidebar-empty">
              <Icon name="folder" size={22} />
              <span>Choose a collection or start from your local notes.</span>
              <button class="btn btn-text sidebar-empty-action" onClick={props.onNewCollectionClick}>
                <Icon name="plus" size={14} />
                Create collection
              </button>
            </div>
          }
        >
          {(col) => (
            <div class="tree-content-container">
              <Show when={collectionsStore.state.movePrompt && collectionsStore.state.movePromptDeferred}>
                <div class="sidebar-move-reminder" role="status">
                  <span>Moved file needs attention.</span>
                  <button class="btn btn-text" onClick={() => props.onReviewMovePrompt()}>Review</button>
                </div>
              </Show>
              <Show when={actionError()}>
                {(error) => (
                  <div class="sidebar-action-error" role="alert">
                    <strong>{error().title}</strong>
                    <span>{error().message}</span>
                    <details><summary>Technical details</summary><code>{error().details}</code></details>
                    <button class="btn btn-text" onClick={() => setActionError(null)}>Dismiss</button>
                  </div>
                )}
              </Show>

              {/* Active Collection Toolbar */}
              <div class="active-col-actions">
                <span class="active-col-section-title">Files</span>
                <div class="active-col-buttons">
                  <button
                    class="btn btn-text btn-icon"
                    onClick={handleAddFiles}
                    aria-label="Add Markdown files"
                    title="Add Markdown files"
                  >
                    <Icon name="file-plus" size={14} />
                  </button>
                  <button
                    class="btn btn-text btn-icon"
                    onClick={handleAddFolderRef}
                    aria-label="Add folder reference"
                    title="Add Folder reference"
                  >
                    <Icon name="folder-plus" size={14} />
                  </button>
                  <button
                    class="btn btn-text btn-icon"
                    onClick={() => {
                      setNewGroupError("");
                      setIsNewGroupOpen(true);
                    }}
                    aria-label="Create virtual group"
                    title="Create virtual group"
                  >
                    <Icon name="plus" size={14} />
                  </button>
                </div>
              </div>

              <div class="tree-content-scroll">
                <div ref={treeRoot} role="tree" aria-label="Notes">
                <Show
                  when={col().entries.length > 0}
                  fallback={
                    <div class="tree-empty">
                      <Icon name="file-plus" size={22} />
                      <span>No notes here yet.</span>
                      <div class="tree-empty-actions">
                        <button class="btn btn-text" onClick={handleAddFiles}>
                          <Icon name="file-plus" size={14} />
                          Add Files
                        </button>
                        <button class="btn btn-text" onClick={handleAddFolderRef}>
                          <Icon name="folder-plus" size={14} />
                          Add Folder
                        </button>
                      </div>
                    </div>
                  }
                >
                  <For each={col().entries}>
                    {(entry, idx) => (
                      <TreeNode
                        entry={entry}
                        depth={0}
                        parentPath={[]}
                        index={idx()}
                        requestSelect={props.requestSelect}
                        requestFolderRefSelect={props.requestFolderRefSelect}
                      />
                    )}
                  </For>
                </Show>
                </div>
              </div>
            </div>
          )}
        </Show>
      </div>

      {/* Footer actions */}
      <div class="sidebar-footer">
        <button
          class="btn btn-text"
          type="button"
          onClick={() => props.onSettingsClick()}
          aria-label="Settings"
          title="Settings"
        >
          <Icon name="settings" size={16} /><span>Settings</span>
        </button>
        <span class="sidebar-local-label"><span aria-hidden="true" />Local workspace</span>
      </div>

      {/* Resize handle */}
      <div
        class={`sidebar-resizer ${isResizing() ? "resizing" : ""}`}
        onMouseDown={handleMouseDown}
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemin={180}
        aria-valuemax={480}
        aria-valuenow={uiStore.state.sidebarWidth}
        tabIndex={uiStore.state.isSidebarOpen ? 0 : -1}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const width = event.key === "Home" ? 180 : event.key === "End" ? 480 : uiStore.state.sidebarWidth + (event.key === "ArrowLeft" ? -16 : 16);
          const next = Math.max(180, Math.min(480, width));
          uiStore.setSidebarWidth(next);
          document.documentElement.style.setProperty("--sidebar-width", `${next}px`);
        }}
      />

      <Dialog
        isOpen={isNewGroupOpen()}
        title="Create Group"
        type="input"
        placeholder="Group name"
        errorMessage={newGroupError()}
        onConfirm={handleCreateRootGroup}
        onClose={() => setIsNewGroupOpen(false)}
      />
    </aside>
  );
}
