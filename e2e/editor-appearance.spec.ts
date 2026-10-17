import { expect, test } from '@playwright/test';
import { installWorkspaceMock } from './helpers/workspaceMock';

for (const theme of ['dark', 'light']) {
  test(`appearance separates theme, note and code colors in ${theme}`, async ({ page }) => {
    const custom =
      theme === 'dark'
        ? {
            modifier: '#55bbff',
            modifierRgb: 'rgb(85, 187, 255)',
            codeBg: '#15202b',
            codeBgRgb: 'rgb(21, 32, 43)',
            background: '#101820',
            backgroundRgb: 'rgb(16, 24, 32)',
            surface: '#182832',
            border: '#405060',
            borderRgb: 'rgb(64, 80, 96)',
          }
        : {
            modifier: '#075985',
            modifierRgb: 'rgb(7, 89, 133)',
            codeBg: '#f1f5fa',
            codeBgRgb: 'rgb(241, 245, 250)',
            background: '#f7f8fc',
            backgroundRgb: 'rgb(247, 248, 252)',
            surface: '#eef1f7',
            border: '#c8d1de',
            borderRgb: 'rgb(200, 209, 222)',
          };
    await installWorkspaceMock(page, theme, false, false, undefined, undefined, {
      'Sample.cs':
        'public class Sample {\n  private int count = 42;\n  public string Name() { return "Hello"; }\n}',
    });
    await page.goto('/e2e/workspace.html');
    const modifier = page
      .locator('.editor-workspace .cm-token-modifier')
      .filter({ hasText: /^private$/ });
    await expect(modifier).toBeVisible();
    const originalColor = await modifier.evaluate((el) => getComputedStyle(el).color);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Edit colors', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await dialog.getByRole('button', { name: 'Typography', exact: true }).click();
    await expect(dialog.getByText('Body font', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Background', { exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Theme', exact: true }).click();
    if (await dialog.getByRole('button', { name: 'Edit colors', exact: true }).count()) await dialog.getByRole('button', { name: 'Edit colors', exact: true }).click();
    await dialog.getByLabel('H1 color', { exact: true }).fill('#ff6688');
    await dialog.getByLabel('Normal text', { exact: true }).fill('#eeeeee');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(modifier).toHaveCSS('color', originalColor);
    await dialog.getByRole('tab', { name: 'Code', exact: true }).click();
    await dialog.getByLabel('Modifiers', { exact: true }).fill(custom.modifier);
    await expect(
      dialog
        .locator('.cm-token-modifier')
        .filter({ hasText: /^private$/ })
        .first()
    ).toHaveCSS('color', custom.modifierRgb);
    await expect(modifier).toHaveCSS('color', originalColor);
    for (const language of ['Java', 'C#', 'C++', 'Rust', 'Python']) {
      await dialog.getByRole('button', { name: language, exact: true }).click();
      const preview = dialog.locator('.code-theme-preview');
      await expect(preview.locator('.cm-token-type').first()).toBeVisible();
      await expect(preview.locator('.cm-token-function').first()).toBeVisible();
      await expect(preview.locator('.cm-token-comment').first()).toBeVisible();
      await expect(preview.locator('.cm-token-annotation').first()).toBeVisible();
      if (language === 'Rust' || language === 'C++')
        await expect(preview.locator('.cm-token-macro').first()).toBeVisible();
    }
    await dialog.getByRole('button', { name: 'C#', exact: true }).click();
    await dialog.getByLabel('Code background', { exact: true }).fill(custom.codeBg);
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(modifier).toHaveCSS('color', custom.modifierRgb);
    await expect(page.locator('.editor-workspace .cm-source-editor')).toHaveCSS(
      'background-color',
      custom.codeBgRgb
    );
    await dialog.getByRole('tab', { name: 'Note', exact: true }).click();
    await expect(dialog.getByLabel('H1 color', { exact: true })).toHaveValue('#ff6688');
    await dialog.getByRole('button', { name: 'Reset note colors', exact: true }).click();
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(modifier).toHaveCSS('color', custom.modifierRgb);
    await dialog.getByRole('button', { name: 'Theme', exact: true }).click();
    await dialog.getByLabel('Background', { exact: true }).fill(custom.background);
    await dialog.getByLabel('Surface', { exact: true }).fill(custom.surface);
    await dialog.getByLabel('Border', { exact: true }).fill(custom.border);
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog).toHaveCSS('background-color', custom.backgroundRgb);
    await expect(dialog.getByLabel('Border', { exact: true })).toHaveValue(custom.border);
    await expect(dialog).not.toHaveCSS('border-left-color', custom.borderRgb);
    await expect(modifier).toHaveCSS('color', custom.modifierRgb);
    await dialog.screenshot({ path: `test-results/appearance-theme-${theme}.png` });
    await dialog.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Edit colors', exact: true }).click();
    await expect(dialog.getByLabel('Background', { exact: true })).toHaveValue(custom.background);
    await dialog.getByRole('button', { name: 'Theme', exact: true }).click();
    if (await dialog.getByRole('button', { name: 'Edit colors', exact: true }).count()) await dialog.getByRole('button', { name: 'Edit colors', exact: true }).click();
    await dialog.getByRole('tab', { name: 'Code', exact: true }).click();
    await expect(dialog.getByLabel('Modifiers', { exact: true })).toHaveValue(custom.modifier);
    await dialog.getByLabel('Modifiers', { exact: true }).scrollIntoViewIfNeeded();
    await dialog.screenshot({ path: `test-results/appearance-code-${theme}.png` });
    await dialog.getByRole('button', { name: 'Reset code colors', exact: true }).click();
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(modifier).toHaveCSS('color', originalColor);
  });
}
