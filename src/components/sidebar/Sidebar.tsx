import { createSignal, onCleanup, Show } from "solid-js";
import { CollectionList } from "./CollectionList";
import { Icon } from "../common/Icon";
import "./Sidebar.css";

interface SidebarProps {
  onNewCollectionClick: () => void;
  onImportFolderClick: () => void;
  onImportZipClick: () => void;
  onSettingsClick: () => void;
}

export function Sidebar(props: SidebarProps) {
  const [isDropdownOpen, setIsDropdownOpen] = createSignal(false);
  let dropdownRef: HTMLDivElement | undefined;

  const handleDocumentClick = (e: MouseEvent) => {
    if (dropdownRef && !dropdownRef.contains(e.target as Node)) {
      setIsDropdownOpen(false);
    }
  };

  document.addEventListener("click", handleDocumentClick);
  onCleanup(() => {
    document.removeEventListener("click", handleDocumentClick);
  });

  return (
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-title">
          <span>Collections</span>
          <span class="sidebar-title-badge">Beta</span>
        </div>
        <div class="sidebar-actions" ref={dropdownRef} style={{ position: "relative" }}>
          <button
            class="btn btn-text"
            onClick={(e) => {
              e.stopPropagation();
              setIsDropdownOpen(!isDropdownOpen());
            }}
            title="Collection options"
            style={{ padding: "4px" }}
          >
            <Icon name="plus" size={18} />
          </button>

          <Show when={isDropdownOpen()}>
            <div class="sidebar-dropdown">
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
                <Icon name="folder" size={14} />
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
      </div>
      
      <div class="sidebar-content">
        <div class="sidebar-section-title">My Collections</div>
        <CollectionList />
      </div>
      
      <div class="sidebar-footer">
        <div class="user-profile">
          <div class="user-avatar">C</div>
          <span>Local Vault</span>
        </div>
        <button
          class="btn btn-text"
          onClick={() => props.onSettingsClick()}
          title="Settings"
          style={{ padding: "4px" }}
        >
          <Icon name="settings" size={18} />
        </button>
      </div>
    </aside>
  );
}
