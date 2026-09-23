import { createSignal, onCleanup, Show, For, onMount } from "solid-js";
import { collectionsStore } from "../../stores/collections";
import { uiStore } from "../../stores/ui";
import { Icon } from "../common/Icon";
import { TreeNode } from "../tree/TreeNode";
import { Dialog } from "../common/Dialog";
import { pickFiles, pickDirectory } from "../../platform";
import { installTreeKeyboardModel } from "../tree/treeAccessibility";
import "./Sidebar.css";

interface SidebarProps {
  onNewCollectionClick: () => void;
  onImportFolderClick: () => void;
  onImportZipClick: () => void;
  onSettingsClick: () => void;
  requestSelect: (entryId: string | null) => Promise<boolean>;
  requestFolderRefSelect: (intent: import("../../features/filesystem/folderRefReadiness").FolderRefIntentInput) => Promise<boolean>;
  requestSwitch: (collectionId: string) => Promise<boolean>;
  operationLeaseRegistry?: import("../../workflows/operationLease").OperationLeaseRegistry;
}

export function Sidebar(props: SidebarProps) {
  const [isDropdownOpen, setIsDropdownOpen] = createSignal(false);
  const [isResizing, setIsResizing] = createSignal(false);
  const [isNewGroupOpen, setIsNewGroupOpen] = createSignal(false);
  const [newGroupError, setNewGroupError] = createSignal("");
  let dropdownRef: HTMLDivElement | undefined;
  let collectionPickerRef: HTMLButtonElement | undefined;
  let treeRoot: HTMLDivElement | undefined;
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
    if (dropdownRef && !dropdownRef.contains(e.target as Node)) {
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
    let newWidth = e.clientX;
    if (newWidth < 180) newWidth = 180;
    if (newWidth > 480) newWidth = 480;
    document.documentElement.style.setProperty("--sidebar-width", `${newWidth}px`);
  };

  const handleMouseUp = (e: MouseEvent) => {
    setIsResizing(false);
    let newWidth = e.clientX;
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
    try {
      const selected = await pickFiles("Select Markdown Notes");
      if (selected && selected.length > 0) {
        await collectionsStore.addFiles(selected);
      }
    } catch (err) {
      console.error("Failed to pick files", err);
    }
  };

  const handleAddFolderRef = async () => {
    try {
      const selected = await pickDirectory("Select Folder to Reference");
      if (selected) {
        await collectionsStore.addFolderRef(selected);
      }
    } catch (err) {
      console.error("Failed to pick directory", err);
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

  return (
    <aside
      aria-label="Collection navigation"
      class={`sidebar ${!uiStore.state.isSidebarOpen ? "collapsed" : ""} ${isResizing() ? "resizing" : ""}`}
    >
      {/* Header with App Brand and toggle button */}
      <div class="sidebar-header">
        <span class="app-brand">Collectives</span>
        <button
          class="btn btn-text btn-icon sidebar-toggle-btn"
          onClick={() => uiStore.toggleSidebar()}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
        >
          <Icon name="menu" size={16} />
        </button>
      </div>

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
              {/* Active Collection Toolbar */}
              <div class="active-col-actions">
                <span class="active-col-section-title">Notes</span>
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

      {/* Footer with Collection Selector and Settings */}
      <div class="sidebar-footer">
        <div class="sidebar-actions-container" ref={dropdownRef} style={{ position: "relative", display: "flex", "align-items": "center", "min-width": 0 }}>
          <button
            ref={collectionPickerRef}
            type="button"
            class="vault-info sidebar-title-selector"
            onClick={(e) => {
              e.stopPropagation();
              setIsDropdownOpen(!isDropdownOpen());
            }}
            title="Switch or manage collections"
            aria-label="Choose collection"
            aria-haspopup="listbox"
            aria-expanded={isDropdownOpen() ? "true" : "false"}
            aria-controls="collection-picker-listbox"
            onKeyDown={handleCollectionPickerKeyDown}
            style={{ cursor: "pointer", display: "flex", "align-items": "center", gap: "8px" }}
          >
            <Icon name="folder" size={14} class="vault-icon" />
            <span class="active-col-name" style={{ "max-width": "110px", "white-space": "nowrap", "overflow": "hidden", "text-overflow": "ellipsis" }}>
              {activeCol()?.name || "Select Collection..."}
            </span>
            <Icon name="chevron-down" size={12} style={{ opacity: 0.6 }} />
          </button>

          {/* Dropdown list */}
          <Show when={isDropdownOpen()}>
            <div class="sidebar-dropdown">
              <span class="dropdown-header">Collections</span>
              <div id="collection-picker-listbox" role="listbox" aria-label="Collections">
              <For each={collectionsStore.state.collections}>
                {(col, index) => (
                  <button
                    class="dropdown-item"
                    classList={{ active: activeCol()?.id === col.id }}
                    type="button"
                    role="option"
                    aria-selected={activeCol()?.id === col.id ? "true" : "false"}
                    onKeyDown={(event) => handleCollectionOptionKeyDown(event, index())}
                    onClick={() => {
                      void props.requestSwitch(col.id);
                      setIsDropdownOpen(false);
                    }}
                  >
                    <Icon name="folder" size={14} />
                    <span class="dropdown-item-text">{col.name}</span>
                  </button>
                )}
              </For>
              </div>

              <div class="dropdown-divider" />

              {/* Create / Import buttons */}
              <button
                class="dropdown-item"
                type="button"
                aria-label="New Collection"
                onClick={() => {
                  props.onNewCollectionClick();
                  setIsDropdownOpen(false);
                }}
              >
                <Icon name="plus" size={14} />
                <span>New Collection</span>
              </button>
              <button
                class="dropdown-item"
                type="button"
                aria-label="Import Local Folder"
                onClick={() => {
                  props.onImportFolderClick();
                  setIsDropdownOpen(false);
                }}
              >
                <Icon name="folder-plus" size={14} />
                <span>Import Local Folder</span>
              </button>
              <button
                class="dropdown-item"
                type="button"
                aria-label="Import ZIP Archive"
                onClick={() => {
                  props.onImportZipClick();
                  setIsDropdownOpen(false);
                }}
              >
                <Icon name="file" size={14} />
                <span>Import ZIP Archive</span>
              </button>
            </div>
          </Show>
        </div>
        <button
          class="btn btn-text btn-icon"
          type="button"
          onClick={() => props.onSettingsClick()}
          aria-label="Settings"
          title="Settings"
        >
          <Icon name="settings" size={18} />
        </button>
      </div>

      {/* Resize handle */}
      <div
        class={`sidebar-resizer ${isResizing() ? "resizing" : ""}`}
        onMouseDown={handleMouseDown}
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
