import { createSignal, createUniqueId, For, Show } from 'solid-js';
import type { CodeColors, Settings, ThemeColors } from '../../types';
import {
  codeColorFields,
  codeColorVariables,
  defaultCodeColors,
  themeColorFields,
} from '../../lib/appearanceColors';
import { accentColorVariables, normalizeAccentColor } from '../../lib/themeColors';
import { CodeThemePreview } from './CodeThemePreview';

function ColorField(props: {
  label: string;
  hint?: string;
  value?: string;
  default: string;
  onChange: (value: string | undefined) => void;
}) {
  const id = createUniqueId();
  return (
    <div class="color-picker-item">
      <label for={id}>{props.label}</label>
      <div class="color-input-wrapper">
        <input
          type="color"
          aria-label={`${props.label} picker`}
          value={
            normalizeAccentColor(props.value) ?? normalizeAccentColor(props.default) ?? '#000000'
          }
          onInput={(event) => props.onChange(event.currentTarget.value)}
        />
        <input
          id={id}
          type="text"
          spellcheck={false}
          placeholder={props.default}
          value={props.value ?? ''}
          onInput={(event) => props.onChange(event.currentTarget.value.trim() || undefined)}
        />
        <button
          type="button"
          class="color-reset"
          aria-label={`Reset ${props.label} color`}
          title="Use default"
          disabled={!props.value}
          onClick={() => props.onChange(undefined)}
        >
          ↺
        </button>
      </div>
      <Show when={props.hint}>
        <span class="color-field-hint">{props.hint}</span>
      </Show>
    </div>
  );
}

type ColorSettingsProps = {
  settings: Settings;
  dark: boolean;
  defaults: Record<string, string>;
  onChange: (settings: Settings) => void;
};

function updatePalette<T extends object>(
  palette: T | null | undefined,
  key: keyof T,
  value: string | undefined
): T | undefined {
  const next = Object.fromEntries(
    Object.entries({ ...palette, [key]: value }).filter(([, color]) => color)
  );
  return Object.keys(next).length ? (next as T) : undefined;
}

export function ThemePaletteControls(props: ColorSettingsProps) {
  const previewStyle = () => ({
    ...Object.fromEntries(
      themeColorFields.map((field) => [
        field.variable,
        props.settings.themeColors?.[field.key] || (props.dark ? field.dark : field.light),
      ])
    ),
    ...(accentColorVariables(props.settings.colorAccent || props.defaults.colorAccent) ?? {}),
  });
  return (
    <div class="theme-section">
      <h4>Interface colors</h4>
      <div class="theme-palette-preview" style={previewStyle()} aria-label="Theme color preview">
        <div class="theme-preview-surface">
          <strong>Collectives</strong>
          <span>Your notes, your space.</span>
        </div>
        <span class="theme-preview-button">New note</span>
      </div>
      <div class="color-pickers-grid">
        <For each={themeColorFields}>
          {(field) => (
            <ColorField
              label={field.label}
              hint={field.example}
              value={props.settings.themeColors?.[field.key]}
              default={props.dark ? field.dark : field.light}
              onChange={(value) =>
                props.onChange({
                  ...props.settings,
                  themeColors: updatePalette<ThemeColors>(
                    props.settings.themeColors,
                    field.key,
                    value
                  ),
                })
              }
            />
          )}
        </For>
        <ColorField
          label="Text selection"
          hint="Selected text in notes and code"
          value={props.settings.colorSelection}
          default={props.defaults.colorSelection}
          onChange={(value) => props.onChange({ ...props.settings, colorSelection: value })}
        />
      </div>
      <button
        type="button"
        class="btn btn-secondary btn-full"
        onClick={() =>
          props.onChange({
            ...props.settings,
            themeColors: undefined,
            colorAccent: undefined,
            colorSelection: undefined,
          })
        }
      >
        Reset interface colors
      </button>
    </div>
  );
}

const noteFields = [
  { key: 'colorBody', label: 'Normal text' },
  { key: 'colorH1', label: 'H1 color' },
  { key: 'colorH2', label: 'H2 color' },
  { key: 'colorH3', label: 'H3 color' },
  { key: 'colorH4', label: 'H4 color' },
  { key: 'colorCodeText', label: 'Inline code text' },
  { key: 'colorCodeBg', label: 'Inline code background' },
  { key: 'colorLink', label: 'Link color' },
  { key: 'colorLinkHover', label: 'Link hover' },
] as const;

export function ContentColorControls(props: ColorSettingsProps) {
  const [tab, setTab] = createSignal<'note' | 'code'>('note');
  const previewStyle = () => {
    const colors = {
      ...defaultCodeColors(props.dark),
      ...Object.fromEntries(
        Object.entries(props.settings.codeColors ?? {}).filter(([, value]) => value)
      ),
    };
    if (!props.settings.codeColors?.activeLineNumber)
      colors.activeLineNumber = props.settings.colorAccent || props.defaults.colorAccent;
    return codeColorVariables(colors);
  };
  const resetNote = () => {
    const next = { ...props.settings };
    for (const field of noteFields) delete next[field.key];
    props.onChange(next);
  };
  return (
    <div class="theme-section">
      <h4>Note and code colors</h4>
      <div class="appearance-color-tabs" role="tablist" aria-label="Content colors">
        <button
          type="button"
          role="tab"
          aria-selected={tab() === 'note'}
          aria-controls="note-color-panel"
          onClick={() => setTab('note')}
        >
          Note
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab() === 'code'}
          aria-controls="code-color-panel"
          onClick={() => setTab('code')}
        >
          Code
        </button>
      </div>
      <Show when={tab() === 'note'}>
        <div
          id="note-color-panel"
          role="tabpanel"
          aria-label="Note colors"
          class="appearance-color-panel"
        >
          <p class="appearance-description">Text, headings, links and inline code in your notes.</p>
          <div class="color-pickers-grid">
            <For each={noteFields}>
              {(field) => (
                <ColorField
                  label={field.label}
                  value={props.settings[field.key]}
                  default={props.defaults[field.key]}
                  onChange={(value) => props.onChange({ ...props.settings, [field.key]: value })}
                />
              )}
            </For>
          </div>
          <button type="button" class="btn btn-secondary btn-full" onClick={resetNote}>
            Reset note colors
          </button>
        </div>
      </Show>
      <Show when={tab() === 'code'}>
        <div
          id="code-color-panel"
          role="tabpanel"
          aria-label="Code colors"
          class="appearance-color-panel"
        >
          <p class="appearance-description">
            Shared by code blocks and source files. Preview changes before applying.
          </p>
          <div style={previewStyle()}>
            <CodeThemePreview />
          </div>
          <div class="color-pickers-grid">
            <For each={codeColorFields}>
              {(field) => (
                <ColorField
                  label={field.label}
                  hint={field.example}
                  value={props.settings.codeColors?.[field.key]}
                  default={
                    field.key === 'activeLineNumber'
                      ? props.settings.colorAccent || props.defaults.colorAccent
                      : props.dark
                        ? field.dark
                        : field.light
                  }
                  onChange={(value) =>
                    props.onChange({
                      ...props.settings,
                      codeColors: updatePalette<CodeColors>(
                        props.settings.codeColors,
                        field.key,
                        value
                      ),
                    })
                  }
                />
              )}
            </For>
          </div>
          <button
            type="button"
            class="btn btn-secondary btn-full"
            onClick={() => props.onChange({ ...props.settings, codeColors: undefined })}
          >
            Reset code colors
          </button>
        </div>
      </Show>
    </div>
  );
}
