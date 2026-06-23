import { For, Show, onCleanup, createEffect } from "solid-js";
import { Icon } from "./Icon";
import "./Common.css";

export interface ContextMenuItem {
  label: string;
  icon?: "file" | "folder" | "virtual-folder" | "warning" | "plus" | "trash" | "edit" | "settings" | "chevron-right" | "chevron-down" | "close" | "folder-plus" | "file-plus" | "search";
  onClick: () => void;
  danger?: boolean;
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

  const handleClickOutside = (e: MouseEvent) => {
    if (menuRef && !menuRef.contains(e.target as Node)) {
      props.onClose();
    }
  };

  createEffect(() => {
    if (props.isOpen) {
      setTimeout(() => {
        window.addEventListener("click", handleClickOutside);
        window.addEventListener("contextmenu", handleClickOutside);
      }, 0);
    } else {
      window.removeEventListener("click", handleClickOutside);
      window.removeEventListener("contextmenu", handleClickOutside);
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
    const menuH = props.items.length * 36 + 12;
    
    if (menuX + menuW > screenW) {
      menuX = Math.max(0, screenW - menuW - 10);
    }
    if (menuY + menuH > screenH) {
      menuY = Math.max(0, screenH - menuH - 10);
    }
    
    return {
      left: `${menuX}px`,
      top: `${menuY}px`,
    };
  };

  return (
    <Show when={props.isOpen}>
      <div
        ref={menuRef}
        class="context-menu"
        style={getPositionStyles()}
        onClick={() => props.onClose()}
      >
        <For each={props.items}>
          {(item) => (
            <>
              <Show when={item.separatorBefore}>
                <div class="context-menu-separator" />
              </Show>
              <div
                class="context-menu-item"
                classList={{ danger: item.danger }}
                onClick={(e) => {
                  e.stopPropagation();
                  item.onClick();
                  props.onClose();
                }}
              >
                <Show when={item.icon}>
                  <Icon name={item.icon!} size={14} />
                </Show>
                <span>{item.label}</span>
              </div>
            </>
          )}
        </For>
      </div>
    </Show>
  );
}
