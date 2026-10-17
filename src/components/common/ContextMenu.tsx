import { Index, Show, onCleanup, createEffect, createSignal, createMemo } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Icon } from './Icon';
import './Common.css';

export interface ContextMenuItem {
  label: string;
  icon?:
    | 'file'
    | 'folder'
    | 'virtual-folder'
    | 'warning'
    | 'plus'
    | 'trash'
    | 'edit'
    | 'settings'
    | 'chevron-right'
    | 'chevron-down'
    | 'close'
    | 'folder-plus'
    | 'file-plus'
    | 'search'
    | 'copy';
  onClick?: () => void;
  children?: ContextMenuItem[];
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

interface Submenu {
  index: number;
  x: number;
  y: number;
}

export function ContextMenu(props: ContextMenuProps) {
  let root: HTMLDivElement | undefined;
  let opener: HTMLElement | null = null;
  let wasOpen = false;
  let activationLocked = false;
  const [trail, setTrail] = createSignal<Submenu[]>([]);
  const rootItems = createMemo(() => props.items);
  const levels = () => {
    const result = [{ items: rootItems(), x: props.x, y: props.y, label: 'Context actions' }];
    for (const step of trail()) {
      const parent = result[result.length - 1].items[step.index];
      if (!parent?.children) break;
      result.push({ items: parent.children, x: step.x, y: step.y, label: parent.label });
    }
    return result;
  };
  const buttons = (level: number) =>
    Array.from(
      root?.querySelectorAll<HTMLButtonElement>(
        `[data-menu-level="${level}"] > button[role="menuitem"]:not([disabled])`
      ) ?? []
    );
  const focusItem = (level: number, index: number) => {
    const items = buttons(level);
    items[Math.min(Math.max(index, 0), Math.max(items.length - 1, 0))]?.focus();
  };
  const restoreFocus = () => {
    if (document.querySelector('[data-modal-focus-scope="true"]')) return;
    // An action may have focused a search field or another control already.
    if (
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body &&
      !root?.contains(document.activeElement)
    )
      return;
    if (opener?.isConnected) {
      opener.focus();
      return;
    }
    const fallback =
      Array.from(document.querySelectorAll<HTMLElement>('[role="tree"] [role="treeitem"]')).find(
        (element) => element.getAttribute('aria-disabled') !== 'true'
      ) ??
      document.querySelector<HTMLElement>(
        '[aria-label="Collapse sidebar"], [aria-label="Expand sidebar"]'
      );
    fallback?.focus();
  };
  const outside = (event: Event) => {
    if (root && !root.contains(event.target as Node)) props.onClose();
  };
  const openSubmenu = (level: number, index: number, button: HTMLElement, focus = false) => {
    const item = levels()[level]?.items[index];
    if (item?.disabled) return;
    if (!item?.children) {
      setTrail(trail().slice(0, level));
      return;
    }
    const rect = button.getBoundingClientRect();
    const x = rect.right + 4 + 192 > innerWidth ? rect.left - 196 : rect.right + 4;
    setTrail([...trail().slice(0, level), { index, x, y: rect.top - 6 }]);
    if (focus) queueMicrotask(() => focusItem(level + 1, 0));
  };
  const activate = (level: number, index: number, button: HTMLElement) => {
    const item = levels()[level]?.items[index];
    if (activationLocked || !item || item.disabled) return;
    if (!item.onClick && item.children) {
      openSubmenu(level, index, button, true);
      return;
    }
    activationLocked = true;
    item.onClick?.();
    props.onClose();
  };
  const onKeyDown = (event: KeyboardEvent, level: number) => {
    event.stopPropagation();
    const target = (event.target as HTMLElement)?.closest<HTMLButtonElement>('[role="menuitem"]');
    const items = buttons(level);
    const index = target ? items.indexOf(target) : 0;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      focusItem(
        level,
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      );
    } else if (event.key === 'ArrowRight' && target) {
      event.preventDefault();
      openSubmenu(level, Number(target.dataset.menuIndex), target, true);
    } else if (event.key === 'ArrowLeft' && level > 0) {
      event.preventDefault();
      const parentIndex = trail()[level - 1].index;
      setTrail(trail().slice(0, level - 1));
      root
        ?.querySelector<HTMLButtonElement>(
          `[data-menu-level="${level - 1}"] > [data-menu-index="${parentIndex}"]`
        )
        ?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      props.onClose();
    } else if ((event.key === 'Enter' || event.key === ' ') && target) {
      event.preventDefault();
      activate(level, Number(target.dataset.menuIndex), target);
    } else if (event.key === 'Tab') props.onClose();
  };
  createEffect(() => {
    if (props.isOpen && !wasOpen) {
      wasOpen = true;
      activationLocked = false;
      setTrail([]);
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      queueMicrotask(() => focusItem(0, 0));
      window.addEventListener('pointerdown', outside);
      window.addEventListener('contextmenu', outside);
      window.addEventListener('resize', props.onClose);
    } else if (!props.isOpen && wasOpen) {
      wasOpen = false;
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('contextmenu', outside);
      window.removeEventListener('resize', props.onClose);
      queueMicrotask(restoreFocus);
    }
  });
  onCleanup(() => {
    window.removeEventListener('pointerdown', outside);
    window.removeEventListener('contextmenu', outside);
    window.removeEventListener('resize', props.onClose);
  });
  const position = (menu: ReturnType<typeof levels>[number]) => {
    const h =
      menu.items.length * 38 + menu.items.filter((item) => item.separatorBefore).length * 9 + 14;
    return {
      left: `${Math.max(8, Math.min(menu.x, innerWidth - 200))}px`,
      top: `${Math.max(8, Math.min(menu.y, innerHeight - Math.min(h, innerHeight - 16) - 8))}px`,
    };
  };
  return (
    <Show when={props.isOpen}>
      <Portal>
        <div
          ref={root}
          class="context-menu-root"
          onContextMenu={(event) => event.preventDefault()}
          onFocusOut={(event) => {
            event.stopPropagation();
            if (event.relatedTarget instanceof Node && root?.contains(event.relatedTarget)) return;
            queueMicrotask(() => {
              if (root && !root.contains(document.activeElement)) props.onClose();
            });
          }}
        >
          <Index each={levels()}>
            {(menu, level) => (
              <div
                class="context-menu"
                role="menu"
                tabIndex={-1}
                aria-label={menu().label}
                data-menu-level={level}
                style={position(menu())}
                onKeyDown={(event) => onKeyDown(event, level)}
              >
                <Index each={menu().items}>
                  {(item, index) => (
                    <>
                      <Show when={item().separatorBefore}>
                        <div class="context-menu-separator" role="separator" />
                      </Show>
                      <button
                        type="button"
                        class="context-menu-item"
                        classList={{ danger: item().danger }}
                        role="menuitem"
                        tabIndex={-1}
                        aria-disabled={item().disabled ? 'true' : undefined}
                        disabled={item().disabled}
                        data-menu-index={index}
                        aria-haspopup={item().children ? 'menu' : undefined}
                        aria-expanded={
                          item().children ? trail()[level]?.index === index : undefined
                        }
                        onPointerEnter={(event) => openSubmenu(level, index, event.currentTarget)}
                        onClick={(event) => {
                          event.stopPropagation();
                          activate(level, index, event.currentTarget);
                        }}
                      >
                        <Show when={item().icon}>
                          <Icon name={item().icon!} size={14} aria-hidden="true" />
                        </Show>
                        <span>{item().label}</span>
                        <Show when={item().children}>
                          <Icon
                            name="chevron-right"
                            size={14}
                            class="context-menu-chevron"
                            aria-hidden="true"
                          />
                        </Show>
                      </button>
                    </>
                  )}
                </Index>
              </div>
            )}
          </Index>
        </div>
      </Portal>
    </Show>
  );
}
