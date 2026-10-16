import { expect, test } from '@playwright/test';
import { installWorkspaceMock } from './helpers/workspaceMock';

for (const selected of [true, false]) {
  test(`remove ${selected ? 'open' : 'other'} file from collection`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await installWorkspaceMock(page);
    await page.goto('/e2e/workspace.html');
    await expect(page.locator('.cm-content')).toContainText('Product direction');
    const row = page.locator(`[data-tree-label="${selected ? 'Product direction' : 'Research and references'}"]`);
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Remove from Collection', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __workspaceCommands: string[] }).__workspaceCommands)).toContain('remove_entry');
    await expect(row).toHaveCount(0);
    if (selected) await expect(page.locator('.cm-content')).toHaveCount(0);
    else await expect(page.locator('.cm-content')).toContainText('Product direction');
    expect(errors).toEqual([]);
  });
}
