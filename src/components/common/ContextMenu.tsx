import { For, Show, onCleanup, createEffect } from "solid-js";
import { Icon } from "./Icon";
import "./Common.css";

export interface ContextMenuItem {
  label: string;
  icon?: "file" | "folder" | "virtual-folder" | "warning" | "plus" | "trash" | "edit" | "settings" | "chevron-right" | "chevron-down" | "close" | "folder-plus" | "file-plus" | "search";
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  isOpen: boolean;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu(props: ContextMenuProps) {
  let menuRef: HTMLDivElement | undefined;
  let opener: HTMLElement | null = null;
  let wasOpen = false;
  let activationLocked = false;

  const focusItem = (index: number) => {
    const elements = menuRef ? Array.from(menuRef.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')) : [];
    const enabled = elements.filter((element) => element.getAttribute("aria-disabled") !== "true");
    const target = enabled[Math.min(Math.max(index, 0), Math.max(enabled.length - 1, 0))];
    target?.focus();
  };

  const restoreFocus = () => {
    if (document.querySelector('[data-modal-focus-scope="true"]')) return;
    if (opener?.isConnected) {
      opener.focus();
      return;
    }
    const treeFallback = Array.from(document.querySelectorAll<HTMLElement>('[role="tree"] [role="treeitem"]'))
      .find((element) => element.getAttribute("aria-disabled") !== "true");
    const sidebarFallback = document.querySelector<HTMLElement>('[aria-label="Collapse sidebar"], [aria-label="Expand sidebar"]');
    (treeFallback ?? sidebarFallback)?.focus();
  };

  const handleClickOutside = (event: MouseEvent) => {
    if (menuRef && !menuRef.contains(event.target as Node)) props.onClose();
  };

  const handleMenuKeyDown = (event: KeyboardEvent) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[role="menuitem"]');
    const elements = menuRef ? Array.from(menuRef.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).filter((element) => element.getAttribute("aria-disabled") !== "true") : [];
    const index = target ? elements.indexOf(target) : 0;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem(elements.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (target) activate(target.dataset.menuIndex ? Number(target.dataset.menuIndex) : index);
    } else if (event.key === "Tab") {
      props.onClose();
    }
  };

  const activate = (index: number) => {
    if (activationLocked) return;
    const item = props.items[index];
    if (!item || item.disabled) return;
    activationLocked = true;
    item.onClick();
    props.onClose();
  };

  createEffect(() => {
    if (props.isOpen && !wasOpen) {
      wasOpen = true;
      activationLocked = false;
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      queueMicrotask(() => {
        menuRef?.focus();
        focusItem(0);
      });
      window.addEventListener("click", handleClickOutside);
      window.addEventListener("contextmenu", handleClickOutside);
    } else if (!props.isOpen && wasOpen) {
      wasOpen = false;
      window.removeEventListener("click", handleClickOutside);
      window.removeEventListener("contextmenu", handleClickOutside);
      queueMicrotask(restoreFocus);
    }
  });

  onCleanup(() => {
    window.removeEventListener("click", handleClickOutside);
    window.removeEventListener("contextmenu", handleClickOutside);
  });

  const getPositionStyles = () => {
    if (!props.isOpen) return {};
    let menuX = props.x;
    let menuY = props.y;
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const menuW = 180;
    const separatorCount = props.items.filter((item) => item.separatorBefore).length;
    const menuH = props.items.length * 36 + separatorCount * 9 + 12;
    if (menuX + menuW > screenW) menuX = Math.max(0, screenW - menuW - 10);
    if (menuY + menuH > screenH) menuY = Math.max(0, screenH - menuH - 10);
    return { left: `${menuX}px`, top: `${menuY}px` };
  };

  return (
    <Show when={props.isOpen}>
      <div
        ref={menuRef}
        class="context-menu"
        role="menu"
        tabIndex={-1}
        aria-label="Context actions"
        style={getPositionStyles()}
        onKeyDown={handleMenuKeyDown}
        onFocusOut={(event) => {
          queueMicrotask(() => {
            if (menuRef && !menuRef.contains(document.activeElement)) props.onClose();
          });
          event.stopPropagation();
        }}
      >
        <For each={props.items}>
          {(item, index) => (
            <>
              <Show when={item.separatorBefore}>
                <div class="context-menu-separator" role="separator" />
              </Show>
              <button
                type="button"
                class="context-menu-item"
                classList={{ danger: item.danger }}
                role="menuitem"
                tabIndex={-1}
                aria-disabled={item.disabled ? "true" : undefined}
                data-menu-index={index()}
                disabled={item.disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  activate(index());
                }}
              >
                <Show when={item.icon}>
                  <Icon name={item.icon!} size={14} aria-hidden="true" />
                </Show>
                <span>{item.label}</span>
              </button>
            </>
          )}
        </For>
      </div>
    </Show>
  );
}
