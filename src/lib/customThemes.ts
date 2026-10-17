import type { Settings, ThemePalette } from '../types';
import { getDefaultThemeValues } from './themeEngine';
import { codeColorFields, defaultCodeColors, themeColorFields } from './appearanceColors';
import { inspiredThemes } from './builtinThemes';

export const noteColorKeys = [
  'colorBody',
  'colorH1',
  'colorH2',
  'colorH3',
  'colorH4',
  'colorCodeText',
  'colorCodeBg',
  'colorLink',
  'colorLinkHover',
] as const;

export function captureTheme(settings: Settings, dark: boolean): ThemePalette {
  const defaults = getDefaultThemeValues(dark);
  const accent = settings.colorAccent || defaults.colorAccent;
  const note = Object.fromEntries(
    noteColorKeys.map((key) => [key, settings[key] || defaults[key]])
  );
  note.colorCodeText = settings.colorCodeText || accent;
  note.colorCodeBg = settings.colorCodeBg || settings.themeColors?.surface || defaults.colorCodeBg;
  for (const key of ['colorH1', 'colorH2', 'colorH3'] as const)
    note[key] = settings[key] || settings.colorBody || defaults[key];
  note.colorH4 = settings.colorH4 || settings.themeColors?.secondaryText || defaults.colorH4;
  return {
    mode: dark ? 'dark' : 'light',
    accent,
    selection: settings.colorSelection || defaults.colorSelection,
    note,
    code: Object.fromEntries(
      codeColorFields.map((field) => [
        field.key,
        settings.codeColors?.[field.key] ||
          (field.key === 'activeLineNumber' ? accent : defaultCodeColors(dark)[field.key]),
      ])
    ),
    interface: Object.fromEntries(
      themeColorFields.map((field) => [
        field.key,
        settings.themeColors?.[field.key] ||
          (field.key === 'hover'
            ? dark
              ? 'rgba(255,255,255,0.05)'
              : 'rgba(0,0,0,0.04)'
            : dark
              ? field.dark
              : field.light),
      ])
    ),
  };
}

export function useTheme(settings: Settings, palette: ThemePalette, id: string): Settings {
  const next = {
    ...settings,
    theme: palette.mode,
    colorAccent: palette.accent,
    colorSelection: palette.selection,
    codeColors: { ...palette.code },
    themeColors: { ...palette.interface },
    activeThemeId: id,
  };
  for (const key of noteColorKeys) next[key] = palette.note[key];
  return next;
}

export function useDefaultTheme(settings: Settings, mode: 'dark' | 'light' | 'system'): Settings {
  const next = {
    ...settings,
    theme: mode,
    colorAccent: undefined,
    colorSelection: undefined,
    codeColors: undefined,
    themeColors: undefined,
    activeThemeId: `default:${mode}`,
  };
  for (const key of noteColorKeys) delete next[key];
  return next;
}

/** Compare effective colors, so shorthand hex and named/RGB colors match. */
export function themeColorKey(palette: ThemePalette): string {
  const probe = document.createElement('span');
  document.body.appendChild(probe);
  try {
    const normalize = (value: string) => {
      probe.style.color = '';
      probe.style.color = value;
      return getComputedStyle(probe).color;
    };
    const entries = [
      ['accent', palette.accent],
      ['selection', palette.selection],
      ...noteColorKeys.map((key) => [`note:${key}`, palette.note[key] ?? '']),
      ...codeColorFields.map((field) => [`code:${field.key}`, palette.code[field.key] ?? '']),
      ...themeColorFields.map((field) => [
        `interface:${field.key}`,
        palette.interface[field.key] ?? '',
      ]),
    ];
    return JSON.stringify(entries.map(([key, value]) => [key, normalize(value)]));
  } finally {
    probe.remove();
  }
}

export const defaultThemes = [
  {
    id: 'default:dark',
    name: 'Default Dark',
    palette: () => captureTheme({ theme: 'dark', fontScale: 1 }, true),
  },
  {
    id: 'default:light',
    name: 'Default Light',
    palette: () => captureTheme({ theme: 'light', fontScale: 1 }, false),
  },
  ...inspiredThemes,
];
