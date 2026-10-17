import { JSX, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import './AppShell.css';
import { Icon } from '../common/Icon';
import { requestEditorMeasure } from '../../lib/editorMeasure';

interface AppShellProps {
  sidebar: JSX.Element;
  workspaceHeader: JSX.Element;
  activityStatus?: JSX.Element;
  workspaceBody: JSX.Element;
  notice?: JSX.Element;
  sidebarCollapsed?: boolean;
  onExpandSidebar?: () => void;
  sidebarHoverEnabled?: boolean;
}

export function AppShell(props: AppShellProps) {
  const [peeking, setPeeking] = createSignal(false);
  let slot: HTMLDivElement | undefined;
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let keyboardNavigation = false;
  let pointer = { x: Infinity, y: Infinity };
  const enabled = () => Boolean(props.sidebarCollapsed) && props.sidebarHoverEnabled !== false;
  const clearReveal = () => {
    clearTimeout(revealTimer);
    revealTimer = undefined;
  };
  const clearHide = () => {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  };
  const nearEdge = () =>
    pointer.x >= 0 && pointer.x <= 14 && pointer.y >= 0 && pointer.y <= innerHeight;
  const insideSidebar = () => {
    const bounds = slot?.querySelector('.sidebar')?.getBoundingClientRect();
    return Boolean(
      bounds &&
      pointer.x >= 0 &&
      pointer.x <= bounds.right + 10 &&
      pointer.y >= bounds.top - 8 &&
      pointer.y <= bounds.bottom + 8
    );
  };
  const reveal = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || !enabled()) return;
    pointer = { x: event.clientX, y: event.clientY };
    clearHide();
    if (peeking() || revealTimer) return;
    revealTimer = setTimeout(() => {
      revealTimer = undefined;
      if (enabled() && nearEdge()) setPeeking(true);
    }, 65);
  };
  const hide = () => {
    if (!peeking() || hideTimer) return;
    hideTimer = setTimeout(() => {
      hideTimer = undefined;
      if (nearEdge() || insideSidebar()) return;
      if (
        document.querySelector('[role="menu"], [data-modal-focus-scope="true"]') ||
        (slot?.contains(document.activeElement) &&
          (keyboardNavigation || document.activeElement?.matches('input, select, textarea')))
      ) {
        hide();
        return;
      }
      if (slot?.contains(document.activeElement))
        document.querySelector<HTMLButtonElement>('[aria-label="Expand sidebar"]')?.focus();
      setPeeking(false);
    }, 200);
  };
  const trackPointer = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    pointer = { x: event.clientX, y: event.clientY };
    if (!enabled()) return;
    if (nearEdge()) reveal(event);
    else {
      clearReveal();
      if (peeking() && insideSidebar()) clearHide();
      else hide();
    }
  };
  onMount(() => {
    const leaveWindow = (event: PointerEvent) => {
      if (event.relatedTarget) return;
      pointer = { x: Infinity, y: Infinity };
      clearReveal();
      hide();
    };
    window.addEventListener('pointermove', trackPointer, { passive: true });
    window.addEventListener('pointerout', leaveWindow);
    onCleanup(() => {
      window.removeEventListener('pointermove', trackPointer);
      window.removeEventListener('pointerout', leaveWindow);
    });
  });
  createEffect(() => {
    if (!props.sidebarCollapsed || props.sidebarHoverEnabled === false) {
      clearHide();
      clearReveal();
      setPeeking(false);
    }
  });
  onCleanup(() => {
    clearHide();
    clearReveal();
  });
  return (
    <div
      class="app-shell island-layout"
      data-app-shell-root="true"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        ref={slot}
        class="app-shell-sidebar-slot"
        classList={{
          'is-collapsed': Boolean(props.sidebarCollapsed),
          'is-hover-open': peeking() && Boolean(props.sidebarCollapsed),
        }}
        inert={Boolean(props.sidebarCollapsed) && !peeking()}
        aria-hidden={props.sidebarCollapsed && !peeking() ? 'true' : undefined}
        onPointerEnter={clearHide}
        onPointerLeave={hide}
        onFocusOut={hide}
        onPointerDown={() => {
          keyboardNavigation = false;
        }}
        onKeyDown={(event) => {
          keyboardNavigation = true;
          if (event.key === 'Escape' && props.sidebarCollapsed) {
            setPeeking(false);
            document.querySelector<HTMLButtonElement>('[aria-label="Expand sidebar"]')?.focus();
          }
        }}
        onTransitionEnd={(event) => {
          if (event.propertyName === 'width') requestEditorMeasure();
        }}
        data-shell-slot="sidebar"
      >
        {props.sidebar}
      </div>
      <Show when={props.sidebarCollapsed && props.sidebarHoverEnabled !== false}>
        <div
          class="sidebar-hover-edge"
          aria-hidden="true"
          onPointerEnter={reveal}
          onPointerLeave={trackPointer}
        />
      </Show>

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
        <Show when={props.activityStatus}>
          <footer class="app-shell-activity" data-shell-slot="activityStatus">
            {props.activityStatus}
          </footer>
        </Show>
      </main>

      <Show when={props.notice}>
        <div class="app-shell-notice-layer">{props.notice}</div>
      </Show>
    </div>
  );
}
