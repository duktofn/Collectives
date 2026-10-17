import { describe, expect, it } from 'vitest';
import { inspiredThemes } from './builtinThemes';
import { codeColorFields, themeColorFields } from './appearanceColors';

const luminance = (hex: string) => {
  const c = [1, 3, 5]
    .map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
};
const ratio = (a: string, b: string) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

describe('reference palette presets', () => {
  it.each(inspiredThemes.map((theme) => [theme.name, theme] as const))(
    '%s has complete readable colors and returns independent copies',
    (_name, theme) => {
      const palette = theme.palette();
      for (const field of codeColorFields)
        expect(palette.code[field.key]).toMatch(/^#[\da-f]{6}$/i);
      for (const field of themeColorFields)
        expect(palette.interface[field.key]).toMatch(/^#[\da-f]{6}$/i);
      for (const field of codeColorFields.filter((field) => field.key !== 'background'))
        expect(ratio(palette.code[field.key]!, palette.code.background!)).toBeGreaterThanOrEqual(
          4.5
        );
      for (const background of [palette.interface.background!, palette.interface.surface!]) {
        for (const color of [
          palette.interface.text!,
          palette.interface.secondaryText!,
          palette.accent,
        ])
          expect(ratio(color, background)).toBeGreaterThanOrEqual(4.5);
      }
      palette.interface.background = '#ff0000';
      expect(theme.palette().interface.background).not.toBe('#ff0000');
    }
  );
});
