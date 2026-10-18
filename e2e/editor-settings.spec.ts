import { expect, test } from '@playwright/test';
import { installWorkspaceMock } from './helpers/workspaceMock';

for (const theme of ['dark', 'light']) {
  test(`Settings reorganizes controls and preserves edits across tabs in ${theme}`, async ({
    page,
  }) => {
    await installWorkspaceMock(page, theme);
    await page.goto('/e2e/workspace.html');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(settings.locator('.theme-panel-tabs [role="tab"]')).toHaveText([
      'Appearance',
      'Behavior',
    ]);
    await expect(settings.getByRole('tab', { name: 'Shortcuts', exact: true })).toHaveCount(0);
    await expect(settings.getByText('Files & Storage', { exact: true })).toHaveCount(0);
    await expect(settings.locator('select')).toHaveCount(0);
    await expect(settings.locator('.appearance-navigation button')).toHaveText([
      'Theme',
      'Typography',
    ]);
    const labelStyles = await settings.locator('label').evaluateAll((labels) =>
      labels
        .filter((label) => ['Theme', 'Theme name'].includes(label.textContent!.trim()))
        .map((label) => {
          const style = getComputedStyle(label);
          return [style.fontFamily, style.fontSize, style.fontWeight, style.color];
        })
    );
    expect(labelStyles).toHaveLength(2);
    expect(labelStyles[0]).toEqual(labelStyles[1]);
    await settings.screenshot({ path: `artifacts/ux-islands/settings-theme-${theme}.png` });

    await settings.getByRole('button', { name: 'Typography', exact: true }).click();
    await expect(settings.getByText('Custom fonts', { exact: true })).toBeVisible();
    await expect(settings.getByRole('combobox', { name: 'Layout', exact: true })).toHaveCount(0);
    const bodyFont = settings.getByRole('combobox', { name: 'Body font', exact: true });
    await bodyFont.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.type('geo');
    await page.keyboard.press('Enter');
    await expect(bodyFont).toHaveText('Georgia');
    await expect(bodyFont).toBeFocused();
    await settings.getByRole('combobox', { name: 'Code font', exact: true }).click();
    await settings.getByRole('option', { name: 'Consolas', exact: true }).click();
    const lineHeight = settings.getByLabel('Line height', { exact: true });
    await settings.getByRole('button', { name: 'Increase line height', exact: true }).click();
    await expect(lineHeight).toHaveValue('1.7');
    await settings.getByRole('button', { name: 'Increase line height', exact: true }).click();
    await expect(lineHeight).toHaveValue('1.8');
    await settings.getByRole('button', { name: 'Decrease line height', exact: true }).click();
    await expect(lineHeight).toHaveValue('1.7');
    await lineHeight.focus();
    await page.keyboard.press('ArrowUp');
    await expect(lineHeight).toHaveValue('1.8');
    const fontScale = settings.getByLabel('Font scale', { exact: true });
    await settings.getByRole('button', { name: 'Increase font scale', exact: true }).click();
    await expect(fontScale).toHaveValue('1.05');
    await settings.getByRole('button', { name: 'Increase font scale', exact: true }).click();
    await expect(fontScale).toHaveValue('1.1');
    await settings.getByRole('button', { name: 'Decrease font scale', exact: true }).click();
    await expect(fontScale).toHaveValue('1.05');
    await fontScale.focus();
    await page.keyboard.press('ArrowUp');
    await expect(fontScale).toHaveValue('1.1');
    await settings.locator('.form-row:has(#line-height)').screenshot({
      path: `artifacts/ux-islands/settings-number-controls-${theme}.png`,
    });
    await expect(settings.locator('input[type="range"]')).toHaveCount(0);
    await settings.getByRole('button', { name: 'Add font', exact: true }).click();
    for (const label of ['Weight', 'Style']) {
      await settings.getByRole('combobox', { name: label, exact: true }).click();
      await expect(settings.getByRole('listbox')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(settings).toBeVisible();
    }
    await settings.screenshot({ path: `artifacts/ux-islands/settings-typography-${theme}.png` });
    await settings.getByRole('tab', { name: 'Behavior', exact: true }).click();
    await expect(
      settings.getByLabel('Reveal hidden sidebar on hover', { exact: true })
    ).toBeVisible();
    await settings.getByRole('combobox', { name: 'Layout', exact: true }).click();
    await settings.getByRole('option', { name: 'Full width', exact: true }).click();
    await settings.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-note-layout', 'wide');
    await expect
      .poll(() =>
        page.locator('html').evaluate((root) => root.style.getPropertyValue('--line-height'))
      )
      .toBe('1.8');
    await expect
      .poll(() =>
        page.locator('html').evaluate((root) => root.style.getPropertyValue('--font-scale'))
      )
      .toBe('1.1');
    await settings.screenshot({ path: `artifacts/ux-islands/settings-behavior-${theme}.png` });
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await settings.getByRole('button', { name: 'Typography', exact: true }).click();
    await expect(bodyFont).toHaveText('Georgia');
    await expect(settings.getByLabel('Line height', { exact: true })).toHaveValue('1.8');
    await expect(settings.getByLabel('Font scale', { exact: true })).toHaveValue('1.1');
  });
}

test('tab transitions honor reduced motion and invalid numeric input cannot be applied', async ({
  page,
}) => {
  await installWorkspaceMock(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/e2e/workspace.html');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('tab', { name: 'Behavior', exact: true }).click();
  await expect(settings.locator('#settings-behavior-panel')).toHaveCSS(
    'animation-name',
    'settings-panel-enter'
  );
  await settings.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await settings.getByRole('button', { name: 'Typography', exact: true }).click();
  await expect(settings.locator('.settings-section-content')).toHaveCSS(
    'animation-name',
    'settings-panel-enter'
  );
  await settings.getByLabel('Line height', { exact: true }).fill('0');
  await expect(settings.getByRole('status')).toContainText(
    'Line height must be a positive number.'
  );
  await expect(settings.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await settings.getByLabel('Line height', { exact: true }).fill('1.6');
  await settings.getByLabel('Font scale', { exact: true }).fill('');
  await expect(settings.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await settings.getByRole('tab', { name: 'Behavior', exact: true }).click();
  await expect(settings.locator('#settings-behavior-panel')).toHaveCSS('animation-name', 'none');
  await settings.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await expect(settings.locator('.settings-section-content')).toHaveCSS('animation-name', 'none');
});

test('number controls respect their lower bound and recover from an empty value', async ({ page }) => {
  await installWorkspaceMock(page);
  await page.goto('/e2e/workspace.html');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('button', { name: 'Typography', exact: true }).click();
  const lineHeight = settings.getByLabel('Line height', { exact: true });
  const fontScale = settings.getByLabel('Font scale', { exact: true });
  await lineHeight.fill('0.1');
  await fontScale.fill('0.1');
  await expect(settings.getByRole('button', { name: 'Decrease line height', exact: true })).toBeDisabled();
  await expect(settings.getByRole('button', { name: 'Decrease font scale', exact: true })).toBeDisabled();
  await settings.getByRole('button', { name: 'Increase line height', exact: true }).click();
  await expect(lineHeight).toHaveValue('0.2');
  await settings.getByRole('button', { name: 'Increase font scale', exact: true }).click();
  await expect(fontScale).toHaveValue('0.15');
  await fontScale.fill('');
  await expect(settings.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await settings.getByRole('button', { name: 'Increase font scale', exact: true }).click();
  await expect(fontScale).toHaveValue('1.05');
  await expect(settings.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
});
