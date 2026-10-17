import { createEffect, createSignal, createUniqueId, For, onCleanup, Show } from 'solid-js';
import { Icon } from '../common/Icon';
import './ThemePicker.css';

export interface SettingsOption {
  value: string;
  label: string;
  group?: string;
  detail?: string;
  colors?: string[];
}

export function SettingsSelect(props: {
  id?: string;
  label: string;
  value: string;
  options: SettingsOption[];
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const generatedId = createUniqueId();
  const id = () => props.id ?? `settings-select-${generatedId}`;
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);
  const [above, setAbove] = createSignal(false);
  const [height, setHeight] = createSignal(320);
  let root!: HTMLDivElement;
  let trigger!: HTMLButtonElement;
  let menu: HTMLDivElement | undefined;
  let search = '';
  let searchTime = 0;
  const selected = () => props.options.find((option) => option.value === props.value);
  const groups = () => [...new Set(props.options.map((option) => option.group ?? ''))];
  const reveal = () => {
    const bounds = trigger.getBoundingClientRect();
    const scroller = root.closest('.theme-panel-content, .dialog-body');
    const viewport = scroller?.getBoundingClientRect();
    const navigation = scroller?.querySelector('.appearance-navigation')?.getBoundingClientRect();
    const below = Math.min(viewport?.bottom ?? innerHeight, innerHeight) - bounds.bottom - 12;
    const aboveSpace = bounds.top - Math.max(navigation?.bottom ?? viewport?.top ?? 0, 0) - 12;
    setAbove(below < 220 && aboveSpace > below);
    setHeight(Math.max(48, Math.min(320, above() ? aboveSpace : below)));
    setActive(
      Math.max(
        0,
        props.options.findIndex((option) => option.value === props.value)
      )
    );
    setOpen(true);
  };
  const choose = (index: number) => {
    const option = props.options[index];
    if (!option) return;
    setOpen(false);
    props.onChange(option.value);
  };
  createEffect(() => {
    if (!open()) return;
    const index = active();
    queueMicrotask(() => {
      const option = menu?.querySelector<HTMLElement>(`[data-option-index="${index}"]`);
      if (!option || !menu) return;
      if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
      else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight)
        menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
    });
  });
  createEffect(() => {
    if (!open()) return;
    const outside = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    const scroller = root.closest('.theme-panel-content, .dialog-body');
    const scrollOutsideMenu = (event: Event) => {
      if (!menu?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', close);
    scroller?.addEventListener('wheel', scrollOutsideMenu, { passive: true });
    onCleanup(() => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', close);
      scroller?.removeEventListener('wheel', scrollOutsideMenu);
    });
  });
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open()) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'Tab') setOpen(false);
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const wasOpen = open();
      if (!wasOpen) reveal();
      if (event.key === 'Home') setActive(0);
      else if (event.key === 'End') setActive(props.options.length - 1);
      else if (wasOpen && (event.key === 'Enter' || event.key === ' ')) choose(active());
      else if (wasOpen)
        setActive(
          (index) =>
            (index + (event.key === 'ArrowDown' ? 1 : -1) + props.options.length) %
            props.options.length
        );
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      if (!open()) reveal();
      search = (Date.now() - searchTime < 700 ? search : '') + event.key.toLowerCase();
      searchTime = Date.now();
      const index = props.options.findIndex((option) =>
        option.label.toLowerCase().startsWith(search)
      );
      if (index >= 0) setActive(index);
    }
  };
  return (
    <div class="input-group theme-picker" ref={root}>
      <label id={`${id()}-label`} for={id()}>
        {props.label}
      </label>
      <button
        ref={trigger}
        id={id()}
        class="theme-picker-trigger"
        type="button"
        role="combobox"
        aria-labelledby={`${id()}-label`}
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-controls={open() ? `${id()}-list` : undefined}
        aria-activedescendant={open() ? `${id()}-option-${active()}` : undefined}
        disabled={!props.options.length}
        onClick={() => (open() ? setOpen(false) : reveal())}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        <span class="theme-picker-name">
          {selected()?.label ?? props.placeholder ?? 'Choose an option'}
        </span>
        <Show when={selected()?.colors}>
          {(colors) => (
            <span class="theme-picker-swatches" aria-hidden="true">
              <For each={colors()}>{(color) => <span style={{ background: color }} />}</For>
            </span>
          )}
        </Show>
        <Icon name="chevron-down" size={16} class="theme-picker-chevron" aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div
          ref={menu}
          id={`${id()}-list`}
          class="theme-picker-menu"
          classList={{ 'opens-above': above() }}
          role="listbox"
          aria-labelledby={`${id()}-label`}
          style={{ 'max-height': `${height()}px` }}
          onPointerDown={(event) => event.preventDefault()}
        >
          <For each={groups()}>
            {(group) => (
              <div role={group ? 'group' : undefined} aria-label={group || undefined}>
                <Show when={group}>
                  <div class="theme-picker-group" aria-hidden="true">
                    {group}
                  </div>
                </Show>
                <For each={props.options.filter((option) => (option.group ?? '') === group)}>
                  {(option) => {
                    const index = () =>
                      props.options.findIndex((candidate) => candidate.value === option.value);
                    return (
                      <div
                        id={`${id()}-option-${index()}`}
                        role="option"
                        aria-label={option.label}
                        aria-selected={props.value === option.value}
                        data-option-index={index()}
                        class="theme-picker-option"
                        classList={{ 'is-active': active() === index() }}
                        onPointerMove={() => setActive(index())}
                        onClick={() => choose(index())}
                      >
                        <span class="theme-picker-check" aria-hidden="true">
                          {props.value === option.value ? '✓' : ''}
                        </span>
                        <span class="theme-picker-name">{option.label}</span>
                        <Show when={option.detail}>
                          <span class="theme-picker-mode">{option.detail}</span>
                        </Show>
                        <Show when={option.colors}>
                          {(colors) => (
                            <span class="theme-picker-swatches" aria-hidden="true">
                              <For each={colors()}>
                                {(color) => <span style={{ background: color }} />}
                              </For>
                            </span>
                          )}
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
