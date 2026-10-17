import { expect, test } from '@playwright/test';
import { installWorkspaceMock } from './helpers/workspaceMock';

for (const theme of ['dark', 'light']) {
  test(`custom accent updates controls and line numbers in ${theme}`, async ({ page }) => {
    await installWorkspaceMock(page, theme, false, false, undefined, undefined, { 'data.json': '{\n  "value": 42\n}' });
    await page.goto('/e2e/workspace.html');
    const activeNumber = page.locator('.cm-lineNumbers .cm-activeLineGutter');
    await expect(activeNumber).toBeVisible();
    const original = await activeNumber.evaluate(el => getComputedStyle(el).color);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Edit colors', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    const color = theme === 'dark' ? '#2563eb' : '#facc15';
    const rgb = theme === 'dark' ? 'rgb(37, 99, 235)' : 'rgb(250, 204, 21)';
    await dialog.getByLabel('Accent color hex', { exact: true }).fill(color);
    await expect(activeNumber).toHaveCSS('color', original);
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(activeNumber).toHaveCSS('color', rgb);
    await expect(dialog.getByLabel('Accent color picker', { exact: true })).toHaveValue(color);
    await dialog.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Edit colors', exact: true }).click();
    await expect(dialog.getByLabel('Accent color hex', { exact: true })).toHaveValue(color);
    await dialog.screenshot({ path: `test-results/accent-settings-${theme}.png` });
    await dialog.getByRole('button', { name: 'Use theme default', exact: true }).click();
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(activeNumber).toHaveCSS('color', original);
    await expect(dialog.getByLabel('Accent color hex', { exact: true })).toHaveValue('');
  });
}
