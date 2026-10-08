import { createEffect, createSignal, createUniqueId, For, JSX, onCleanup, Show } from 'solid-js';

interface ToolbarMenuProps {
  label: string;
  trigger: JSX.Element;
  class?: string;
  items: Array<{ label: string; onSelect: () => void; checked?: boolean }>;
}

/** Anchored actions with the same keyboard and dismissal behavior across toolbars. */
export function ToolbarMenu(props: ToolbarMenuProps) {
  const [open, setOpen] = createSignal(false);
  const menuId = `toolbar-menu-${createUniqueId()}`;
  let root: HTMLDivElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  let menu: HTMLDivElement | undefined;
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger?.focus();
  };
  const outside = (event: PointerEvent) => {
    if (root && !root.contains(event.target as Node)) close();
  };
  createEffect(() => {
    if (!open()) return;
    document.addEventListener('pointerdown', outside);
    queueMicrotask(() => menu?.querySelector<HTMLButtonElement>('button')?.focus());
    onCleanup(() => document.removeEventListener('pointerdown', outside));
  });
  const handleKeys = (event: KeyboardEvent) => {
    const buttons = Array.from(menu?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | undefined;
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      buttons[next]?.focus();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
    if (event.key === 'Tab') close(true);
  };
  return (
    <div
      class="editor-more-actions-wrap"
      ref={root}
      onFocusOut={() =>
        queueMicrotask(() => {
          if (root && !root.contains(document.activeElement)) close();
        })
      }
    >
      <button
        ref={trigger}
        class={props.class ?? 'editor-more-btn'}
        type="button"
        aria-label={props.label}
        title={props.label}
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-controls={open() ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {props.trigger}
      </button>
      <Show when={open()}>
        <div
          ref={menu}
          id={menuId}
          class="editor-more-menu"
          role="menu"
          aria-label={props.label}
          onKeyDown={handleKeys}
        >
          <For each={props.items}>
            {(item) => (
              <button
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                aria-checked={item.checked}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
              >
                <span>{item.label}</span>
                <Show when={item.checked}>
                  <span aria-hidden="true">✓</span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
