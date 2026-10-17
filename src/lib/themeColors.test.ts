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
  it('keeps note, code and interface colors independent and clears palette overrides on reset', () => {
    const root = document.documentElement;
    applyThemeSettings({ theme: 'dark', fontScale: 1, colorH1: '#ff6688', colorH2: '#ff0000', colorH3: '#0000ff', colorBody: '#dddddd', colorCodeText: '#00ff00' });
    expect(root.style.getPropertyValue('--syntax-modifier')).toBe('');
    expect(root.style.getPropertyValue('--syntax-type')).toBe('');
    expect(root.style.getPropertyValue('--syntax-variable')).toBe('');
    expect(root.style.getPropertyValue('--syntax-string')).toBe('');
    expect(root.style.getPropertyValue('--color-text-primary')).toBe('');
    expect(root.style.getPropertyValue('--color-note-text')).toBe('#dddddd');
    applyThemeSettings({ theme: 'dark', fontScale: 1, colorH1: '#ff6688', codeColors: { modifier: '#ee99aa', text: '#ffffff' }, themeColors: { background: '#101820', surface: '#182832', border: '#405060', text: '#cccccc' } });
    expect(root.style.getPropertyValue('--syntax-modifier')).toBe('#ee99aa');
    expect(root.style.getPropertyValue('--syntax-text')).toBe('#ffffff');
    expect(root.style.getPropertyValue('--color-h1')).toBe('#ff6688');
    expect(root.style.getPropertyValue('--color-text-primary')).toBe('#cccccc');
    expect(root.style.getPropertyValue('--bg-primary')).toBe('#101820');
    expect(root.style.getPropertyValue('--bg-secondary')).toBe('#182832');
    applyThemeSettings({ theme: 'light', fontScale: 1 });
    for (const variable of ['--syntax-modifier', '--syntax-text', '--color-h1', '--color-text-primary', '--bg-primary', '--bg-secondary', '--bg-modal', '--color-border-hover']) {
      expect(root.style.getPropertyValue(variable)).toBe('');
    }
  });
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
