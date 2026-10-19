import { expect, test } from '@playwright/test';
import { installWorkspaceMock } from './helpers/workspaceMock';

for (const editDuringRead of [false, true]) {
  test(`failed file open keeps the displayed selection${editDuringRead ? ' and edits made during the read' : ''}`, async ({ page }) => {
    await installWorkspaceMock(page, 'dark', false, false, undefined, undefined, {
      'Slot0.json': 'null',
      'Slot4.json': 'null',
      'Slot1.dat': 'other text file',
    });
    await page.addInitScript(({ editDuringRead }) => {
      const host = window as unknown as {
        __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
        __missingReadStarted: boolean;
        __rejectMissingRead: () => void;
        __fileWrites: Record<string, unknown>[];
      };
      host.__fileWrites = [];
      const invoke = host.__TAURI_INTERNALS__.invoke;
      host.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
        if (command === 'read_file' && String(args.path).endsWith('Slot4.json')) {
          const error = { code: 'stale_read', message: 'The system cannot find the file specified. (os error 2)' };
          if (!editDuringRead) throw error;
          host.__missingReadStarted = true;
          return new Promise((_resolve, reject) => { host.__rejectMissingRead = () => reject(error); });
        }
        if (command === 'write_file') host.__fileWrites.push(args);
        return invoke(command, args);
      };
    }, { editDuringRead });
    await page.goto('/e2e/workspace.html');
    const current = page.locator('[data-tree-label="Slot0.json"]');
    const missing = page.locator('[data-tree-label="Slot4.json"]');
    await expect(page.locator('.cm-content')).toHaveText('null');
    await missing.click();
    if (editDuringRead) {
      await expect.poll(() => page.evaluate(() => (window as unknown as { __missingReadStarted: boolean }).__missingReadStarted)).toBe(true);
      await page.locator('.cm-content').press('Control+End');
      await page.keyboard.insertText('\n42');
      await page.evaluate(() => (window as unknown as { __rejectMissingRead: () => void }).__rejectMissingRead());
    }
    await expect(page.locator('.app-notice')).toContainText('Could not open Slot4.json');
    await expect(current).toHaveAttribute('aria-selected', 'true');
    await expect(missing).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('.editor-error-banner')).toHaveCount(0);
    await expect(page.locator('.cm-content')).toContainText(editDuringRead ? '42' : 'null');
    await page.locator('[data-tree-label="Slot1.dat"]').click();
    await expect(page.locator('.cm-content')).toHaveText('other text file');
    if (editDuringRead) {
      await expect.poll(() => page.evaluate(() => (window as unknown as { __fileWrites: Record<string, unknown>[] }).__fileWrites)).toContainEqual({
        path: 'D:/Sample/Knowledge/Slot0.json', content: 'null\n42', precondition: { kind: 'version', token: 'sample-v1' },
      });
    }
    await missing.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Remove from Collection', exact: true }).click();
    await expect(missing).toHaveCount(0);
    await expect(page.locator('.cm-content')).toHaveText('other text file');
  });
}
