import { createSignal, For, Show, type JSX } from 'solid-js';
import type { CustomTheme, Settings, ThemePalette } from '../../types';
import {
  captureTheme,
  defaultThemes,
  themeColorKey,
  useDefaultTheme,
  useTheme,
} from '../../lib/customThemes';
import { Dialog } from '../common/Dialog';
import { ThemePicker } from './ThemePicker';
import { SettingsSelect } from './SettingsSelect';

export function ThemeManager(props: {
  settings: Settings;
  dark: boolean;
  onChange: (settings: Settings) => void;
  children: JSX.Element;
  error?: string | null;
}) {
  const [editing, setEditing] = createSignal(false);
  const [name, setName] = createSignal('');
  const [message, setMessage] = createSignal('');
  const [duplicate, setDuplicate] = createSignal<{
    palette: ThemePalette;
    name: string;
    matches: Array<{ id: string; name: string }>;
  } | null>(null);
  const [replacing, setReplacing] = createSignal(false);
  const [target, setTarget] = createSignal('');
  const customThemes = () =>
    (props.settings.customThemes ?? []).filter((theme) => !theme.id.startsWith('default:'));
  const preview = () => captureTheme(props.settings, props.dark);
  const selectedName = () =>
    props.settings.activeThemeId === 'default:system'
      ? 'Follow system'
      : ([...defaultThemes, ...customThemes()].find(
          (theme) => theme.id === props.settings.activeThemeId
        )?.name ?? 'Current colors');
  const selectTheme = (id: string) => {
    if (id === 'default:dark' || id === 'default:light' || id === 'default:system')
      props.onChange(useDefaultTheme(props.settings, id.slice(8) as 'dark' | 'light' | 'system'));
    else {
      const builtin = defaultThemes.find((theme) => theme.id === id);
      const custom = customThemes().find((theme) => theme.id === id);
      if (builtin) props.onChange(useTheme(props.settings, builtin.palette(), id));
      else if (custom) props.onChange(useTheme(props.settings, custom.palette, id));
    }
    setMessage('');
    setEditing(true);
  };
  const save = (palette: ThemePalette, newName: string, replaceId?: string) => {
    if (props.error) {
      setMessage(props.error);
      return;
    }
    const existing = replaceId ? customThemes().find((theme) => theme.id === replaceId) : null;
    if (replaceId && !existing) return;
    const saved: CustomTheme = {
      id: existing?.id ?? crypto.randomUUID(),
      name: existing?.name ?? newName.trim(),
      palette,
    };
    props.onChange({
      ...props.settings,
      activeThemeId: saved.id,
      customThemes: existing
        ? customThemes().map((theme) => (theme.id === existing.id ? saved : theme))
        : [...customThemes(), saved],
    });
    setMessage(existing ? 'Theme replaced.' : 'Theme added.');
    setName('');
    setDuplicate(null);
    setReplacing(false);
  };
  const saveNew = () => {
    if (!name().trim()) {
      setMessage('Enter a theme name.');
      return;
    }
    const palette = captureTheme(props.settings, props.dark);
    const key = themeColorKey(palette);
    const matches = [
      ...defaultThemes.map((theme) => ({ ...theme, palette: theme.palette() })),
      ...customThemes(),
    ]
      .filter((theme) => themeColorKey(theme.palette) === key)
      .map((theme) => ({ id: theme.id, name: theme.name }));
    if (matches.length) {
      setTarget(matches.find((theme) => !theme.id.startsWith('default:'))?.id ?? '');
      setDuplicate({ palette, name: name().trim(), matches });
    } else save(palette, name());
  };
  return (
    <div class="theme-manager">
      <ThemePicker
        value={props.settings.activeThemeId}
        customThemes={customThemes()}
        onChange={selectTheme}
      />
      <div
        class="theme-library-preview"
        style={{
          background: preview().interface.background,
          color: preview().interface.text,
          'border-color': preview().interface.border,
        }}
        aria-label="Selected theme preview"
      >
        <div>
          <strong>{selectedName()}</strong>
          <small>{preview().mode === 'dark' ? 'Dark' : 'Light'}</small>
        </div>
        <div class="theme-library-swatches" aria-hidden="true">
          <For
            each={[
              preview().interface.background,
              preview().interface.surface,
              preview().accent,
              preview().code.type,
              preview().code.string,
            ]}
          >
            {(color) => <span style={{ background: color }} />}
          </For>
        </div>
      </div>
      <div class="theme-save-actions">
        <button
          type="button"
          class="btn btn-secondary"
          aria-expanded={editing()}
          onClick={() => setEditing((open) => !open)}
        >
          {editing() ? 'Hide colors' : 'Edit colors'}
        </button>
        <Show when={props.settings.activeThemeId?.startsWith('default:')}>
          <button
            type="button"
            class="btn btn-secondary"
            onClick={() => selectTheme(props.settings.activeThemeId!)}
          >
            Reset preset
          </button>
        </Show>
      </div>
      <Show when={editing()}>
        <div class="theme-editor-colors">{props.children}</div>
      </Show>
      <div class="theme-save-controls">
        <label for="custom-theme-name">Theme name</label>
        <input
          id="custom-theme-name"
          type="text"
          maxlength={64}
          value={name()}
          placeholder="My theme"
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <div class="theme-save-actions">
          <button
            type="button"
            class="btn btn-secondary"
            disabled={Boolean(props.error)}
            onClick={saveNew}
          >
            Save new
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            disabled={!customThemes().length || Boolean(props.error)}
            onClick={() => {
              setTarget(
                customThemes().find((theme) => theme.id === props.settings.activeThemeId)?.id ??
                  customThemes()[0]?.id ??
                  ''
              );
              setReplacing(true);
            }}
          >
            Replace
          </button>
        </div>
        <small>Default themes are read-only. Apply keeps your themes and settings.</small>
        <Show when={message()}>
          <p role="status">{message()}</p>
        </Show>
      </div>
      <Dialog
        isOpen={replacing()}
        title="Replace theme"
        type="confirm"
        confirmLabel="Replace"
        onClose={() => setReplacing(false)}
        onConfirm={() => save(captureTheme(props.settings, props.dark), '', target())}
      >
        <SettingsSelect
          id="replace-theme"
          label="Custom theme"
          value={target()}
          options={customThemes().map((theme) => ({ value: theme.id, label: theme.name }))}
          onChange={setTarget}
        />
      </Dialog>
      <Dialog
        isOpen={Boolean(duplicate())}
        title="Matching colors"
        type="confirm"
        confirmLabel="Save anyway"
        onClose={() => setDuplicate(null)}
        onConfirm={() => {
          const pending = duplicate();
          if (pending) save(pending.palette, pending.name);
        }}
      >
        <Show when={duplicate()}>
          {(pending) => (
            <>
              <p>
                Same colors as{' '}
                {pending()
                  .matches.map((theme) => `“${theme.name}”`)
                  .join(', ')}
                .
              </p>
              <Show
                when={pending().matches.some((theme) => !theme.id.startsWith('default:'))}
                fallback={<p>Default themes cannot be replaced.</p>}
              >
                <SettingsSelect
                  id="matching-theme"
                  label="Replace existing"
                  value={target()}
                  options={pending()
                    .matches.filter((theme) => !theme.id.startsWith('default:'))
                    .map((theme) => ({ value: theme.id, label: theme.name }))}
                  onChange={setTarget}
                />
                <button
                  type="button"
                  class="btn btn-secondary"
                  onClick={() => save(pending().palette, pending().name, target())}
                >
                  Replace existing
                </button>
              </Show>
            </>
          )}
        </Show>
      </Dialog>
    </div>
  );
}
