import { JSX, Show } from 'solid-js';
import './AppShell.css';
import { Icon } from '../common/Icon';

interface AppShellProps {
  sidebar: JSX.Element;
  workspaceHeader: JSX.Element;
  activityStatus: JSX.Element;
  workspaceBody: JSX.Element;
  notice?: JSX.Element;
  sidebarCollapsed?: boolean;
  onExpandSidebar?: () => void;
}

export function AppShell(props: AppShellProps) {
  return (
    <div class="app-shell island-layout" data-app-shell-root="true">
      <div
        class="app-shell-sidebar-slot"
        classList={{ 'is-collapsed': Boolean(props.sidebarCollapsed) }}
        data-shell-slot="sidebar"
      >
        {props.sidebar}
      </div>

      <main class="app-shell-main" aria-label="Collectives workspace">
        <header class="app-shell-header" data-shell-slot="workspaceHeader">
          <Show when={props.sidebarCollapsed && props.onExpandSidebar}>
            <button
              class="app-shell-sidebar-expand ds-icon-button"
              aria-label="Expand sidebar"
              title="Expand sidebar"
              onClick={() => props.onExpandSidebar?.()}
            >
              <Icon name="menu" size={18} aria-hidden="true" />
            </button>
          </Show>
          {props.workspaceHeader}
        </header>
        <div class="app-shell-body" data-shell-slot="workspaceBody">
          {props.workspaceBody}
        </div>
        <footer class="app-shell-activity" data-shell-slot="activityStatus">
          {props.activityStatus}
        </footer>
      </main>

      <Show when={props.notice}>
        <div class="app-shell-notice-layer">{props.notice}</div>
      </Show>
    </div>
  );
}
