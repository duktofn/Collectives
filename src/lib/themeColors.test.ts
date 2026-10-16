import { afterEach, describe, expect, it, vi } from 'vitest';
import { accentColorVariables, normalizeAccentColor } from './themeColors';
import { applyThemeSettings } from './themeEngine';

vi.mock('../platform', () => ({ convertFileSrc: vi.fn() }));
vi.mock('./editorMeasure', () => ({ requestEditorMeasure: vi.fn() }));

afterEach(() => {
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
});

describe('custom accent', () => {
  it('accepts picker hex colors and expands shorthand', () => {
    expect(normalizeAccentColor(' #AbC ')).toBe('#aabbcc');
    expect(normalizeAccentColor('#2563EB')).toBe('#2563eb');
    for (const invalid of [undefined, null, '', '#zzzzzz', '#12345', 'red']) {
      expect(normalizeAccentColor(invalid)).toBeNull();
    }
  });

  it.each([
    ['#000000', '#ffffff'], ['#ffffff', '#000000'],
    ['#2563eb', '#ffffff'], ['#facc15', '#000000'],
  ])('keeps button text readable on %s', (accent, text) => {
    expect(accentColorVariables(accent)?.['--color-on-accent']).toBe(text);
  });

  it('applies all accent states and removes them on reset', () => {
    const root = document.documentElement;
    applyThemeSettings({ theme: 'dark', fontScale: 1, colorAccent: '#2563eb' });
    expect(root.style.getPropertyValue('--color-accent')).toBe('#2563eb');
    expect(root.style.getPropertyValue('--color-on-accent')).toBe('#ffffff');
    expect(root.style.getPropertyValue('--color-accent-bg')).toBe('rgba(37, 99, 235, 0.12)');
    expect(root.style.getPropertyValue('--color-accent-hover')).toContain('--accent-hover-target');
    applyThemeSettings({ theme: 'light', fontScale: 1 });
    for (const variable of ['--color-accent', '--color-accent-bg', '--color-accent-hover', '--color-on-accent']) {
      expect(root.style.getPropertyValue(variable)).toBe('');
    }
  });
});
