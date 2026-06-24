import { createSignal, onCleanup, Show, For, onMount } from "solid-js";
import { collectionsStore } from "../../stores/collections";
import { uiStore } from "../../stores/ui";
import { Icon } from "../common/Icon";
import { TreeNode } from "../tree/TreeNode";
import { Dialog } from "../common/Dialog";
import { pickFiles, pickDirectory } from "../../lib/tauri";
import "./Sidebar.css";

interface SidebarProps {
  onNewCollectionClick: () => void;
  onImportFolderClick: () => void;
  onImportZipClick: () => void;
  onSettingsClick: () => void;
}

export function Sidebar(props: SidebarProps) {
  const [isDropdownOpen, setIsDropdownOpen] = createSignal(false);
  const [isResizing, setIsResizing] = createSignal(false);
  const [isNewGroupOpen, setIsNewGroupOpen] = createSignal(false);
  const [newGroupError, setNewGroupError] = createSignal("");
  let dropdownRef: HTMLDivElement | undefined;

  // Set the CSS variable on mount based on store state
  onMount(() => {
    document.documentElement.style.setProperty("--sidebar-width", `${uiStore.state.sidebarWidth}px`);
  });

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
    await collectionsStore.createGroup(name, []);
    setIsNewGroupOpen(false);
    setNewGroupError("");
  };

  const activeCol = () => collectionsStore.activeCollection();

  return (
    <aside
      class={`sidebar ${!uiStore.state.isSidebarOpen ? "collapsed" : ""} ${isResizing() ? "resizing" : ""}`}
      style={{ width: uiStore.state.isSidebarOpen ? "var(--sidebar-width)" : "0px" }}
    >
      {/* Header with collection dropdown */}
      <div class="sidebar-header">
        <div class="sidebar-actions-container" ref={dropdownRef} style={{ position: "relative", flex: 1, "min-width": 0 }}>
          <div
            class="sidebar-title-selector"
            onClick={(e) => {
              e.stopPropagation();
              setIsDropdownOpen(!isDropdownOpen());
            }}
            title="Switch or manage collections"
          >
            <span class="active-col-name">
              {activeCol()?.name || "Select Collection..."}
            </span>
            <Icon name="chevron-down" size={14} />
          </div>

          {/* Dropdown list */}
          <Show when={isDropdownOpen()}>
            <div class="sidebar-dropdown">
              <span class="dropdown-header">Collections</span>
              <For each={collectionsStore.state.collections}>
                {(col) => (
                  <button
                    class="dropdown-item"
                    classList={{ active: activeCol()?.id === col.id }}
                    onClick={() => {
                      collectionsStore.openCollection(col.id);
                      setIsDropdownOpen(false);
                    }}
                  >
                    <Icon name="folder" size={14} />
                    <span class="dropdown-item-text">{col.name}</span>
                  </button>
                )}
              </For>

              <div class="dropdown-divider" />

              {/* Create / Import buttons */}
              <button
                class="dropdown-item"
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
          class="btn btn-text btn-icon sidebar-toggle-btn"
          onClick={() => uiStore.toggleSidebar()}
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
              Open a collection from the header dropdown to view notes.
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
                    title="Add Markdown files"
                  >
                    <Icon name="file-plus" size={14} />
                  </button>
                  <button
                    class="btn btn-text btn-icon"
                    onClick={handleAddFolderRef}
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
                    title="Create virtual group"
                  >
                    <Icon name="plus" size={14} />
                  </button>
                </div>
              </div>

              <div class="tree-content-scroll">
                <Show
                  when={col().entries.length > 0}
                  fallback={
                    <div class="tree-empty">
                      No entries. Add files or folders using options.
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
                      />
                    )}
                  </For>
                </Show>
              </div>
            </div>
          )}
        </Show>
      </div>

      {/* Footer */}
      <div class="sidebar-footer">
        <div class="user-profile">
          <div class="user-avatar">C</div>
          <span>Local Vault</span>
        </div>
        <button
          class="btn btn-text btn-icon"
          onClick={() => props.onSettingsClick()}
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
