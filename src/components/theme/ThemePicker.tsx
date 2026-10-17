import { createMemo } from 'solid-js';
import type { CustomTheme, ThemePalette } from '../../types';
import { defaultThemes } from '../../lib/customThemes';
import { SettingsSelect } from './SettingsSelect';

export function ThemePicker(props: {
  value?: string;
  customThemes: CustomTheme[];
  onChange: (id: string) => void;
}) {
  const swatches = (palette: ThemePalette) =>
    [palette.interface.background, palette.interface.surface, palette.accent].filter(
      (color): color is string => Boolean(color)
    );
  const options = createMemo(() => [
    ...defaultThemes.map((theme) => {
      const palette = theme.palette();
      return {
        value: theme.id,
        label: theme.name,
        group: 'Built-in themes',
        detail: palette.mode === 'dark' ? 'Dark' : 'Light',
        colors: swatches(palette),
      };
    }),
    { value: 'default:system', label: 'Follow system', group: 'Built-in themes', detail: 'Auto' },
    ...props.customThemes.map((theme) => ({
      value: theme.id,
      label: theme.name,
      group: 'Your themes',
      detail: theme.palette.mode === 'dark' ? 'Dark' : 'Light',
      colors: swatches(theme.palette),
    })),
  ]);
  return (
    <SettingsSelect
      label="Theme"
      value={props.value ?? ''}
      options={options()}
      placeholder="Current colors"
      onChange={props.onChange}
    />
  );
}
