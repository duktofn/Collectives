import { afterEach, expect, it, vi } from 'vitest';
import { installReleaseGuards } from './releaseGuards';

let cleanup = () => {};
afterEach(() => cleanup());

it.each([
  { key: 'F12' },
  { key: 'F12', ctrlKey: true },
  { key: 'u', ctrlKey: true },
  { key: 'U', ctrlKey: true, shiftKey: true },
  ...['i', 'j', 'c', 'k'].map((key) => ({ key, ctrlKey: true, shiftKey: true })),
  ...['i', 'j', 'c', 'u'].map((key) => ({ key, metaKey: true, altKey: true })),
])('blocks browser inspection shortcut %j before app handlers', (shortcut) => {
  cleanup = installReleaseGuards();
  const editor = document.createElement('textarea');
  document.body.appendChild(editor);
  const handler = vi.fn();
  editor.addEventListener('keydown', handler);
  const event = new KeyboardEvent('keydown', { ...shortcut, bubbles: true, cancelable: true });
  editor.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(handler).not.toHaveBeenCalled();
  editor.remove();
});

it('preserves editing shortcuts and custom context menus', () => {
  cleanup = installReleaseGuards();
  for (const key of ['c', 'v', 'x', 's', 'n', 'p', 'f', 'a', 'b', 'i', 'z', 'y']) {
    const event = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  const editor = document.createElement('div');
  document.body.appendChild(editor);
  const customMenu = vi.fn();
  editor.addEventListener('contextmenu', customMenu);
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  editor.dispatchEvent(event);
  expect(customMenu).toHaveBeenCalledOnce();
  expect(event.defaultPrevented).toBe(true);
  editor.remove();
});

it('removes the restrictions when the app is unmounted', () => {
  cleanup = installReleaseGuards();
  cleanup();
  const event = new KeyboardEvent('keydown', { key: 'F12', bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});
