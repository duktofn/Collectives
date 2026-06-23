import { CollectionList } from "./CollectionList";
import { Icon } from "../common/Icon";
import "./Sidebar.css";

interface SidebarProps {
  onNewCollectionClick: () => void;
  onSettingsClick: () => void;
}

export function Sidebar(props: SidebarProps) {
  return (
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-title">
          <span>Collections</span>
          <span class="sidebar-title-badge">Beta</span>
        </div>
        <div class="sidebar-actions">
          <button
            class="btn btn-text"
            onClick={() => props.onNewCollectionClick()}
            title="Create new collection"
            style={{ padding: "4px" }}
          >
            <Icon name="plus" size={18} />
          </button>
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
