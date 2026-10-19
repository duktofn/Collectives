import { expect, test } from '@playwright/test';
import { installWorkspaceMock } from './helpers/workspaceMock';

test('custom themes detect matching colors and never replace defaults', async ({ page }) => {
  await installWorkspaceMock(page);
  await page.goto('/e2e/workspace.html');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByLabel('Theme name', { exact: true }).fill('Default copy');
  await settings.getByRole('button', { name: 'Save new', exact: true }).click();
  const matching = page.getByRole('dialog', { name: 'Matching colors', exact: true });
  await expect(matching).toContainText('Default Dark');
  await expect(matching).toContainText('Default themes cannot be replaced');
  await expect(matching.getByRole('button', { name: 'Replace existing', exact: true })).toHaveCount(
    0
  );
  await matching.getByRole('button', { name: 'Save anyway', exact: true }).click();
  await expect(matching).toHaveCount(0);
  await settings.getByRole('button', { name: 'Edit colors', exact: true }).click();
  await settings.getByLabel('Accent color hex', { exact: true }).fill('#abc');
  await settings.getByLabel('Theme name', { exact: true }).fill('Breeze');
  await settings.getByRole('button', { name: 'Save new', exact: true }).click();
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await settings.getByLabel('Accent color hex', { exact: true }).fill('#aabbcc');
  await settings.getByLabel('Theme name', { exact: true }).fill('Another breeze');
  await settings.getByRole('button', { name: 'Save new', exact: true }).click();
  await expect(matching).toContainText('Breeze');
  await matching.screenshot({ path: 'test-results/matching-theme-colors.png' });
  await matching.getByRole('button', { name: 'Replace existing', exact: true }).click();
  await settings.getByRole('combobox', { name: 'Theme', exact: true }).click();
  await expect(
    settings.getByRole('group', { name: 'Your themes', exact: true }).getByRole('option')
  ).toHaveCount(2);
  await page.keyboard.press('Escape');
  await settings.getByRole('button', { name: 'Replace', exact: true }).click();
  const replacing = page.getByRole('dialog', { name: 'Replace theme', exact: true });
  await replacing.getByRole('combobox', { name: 'Custom theme', exact: true }).click();
  await expect(replacing.getByRole('option')).toHaveCount(2);
  await expect(replacing.getByRole('option', { name: 'Default Dark', exact: true })).toHaveCount(0);
  await replacing.getByRole('option', { name: 'Default copy', exact: true }).click();
  await replacing.getByRole('button', { name: 'Replace', exact: true }).click();
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settings.getByRole('combobox', { name: 'Theme', exact: true }).click();
  await expect(
    settings.getByRole('group', { name: 'Your themes', exact: true }).getByRole('option')
  ).toHaveCount(2);
  await settings.getByRole('option', { name: 'Default Dark', exact: true }).click();
  await expect(settings.getByLabel('Accent color hex', { exact: true })).toHaveValue('');
  await settings.getByRole('combobox', { name: 'Theme', exact: true }).click();
  await settings.getByRole('option', { name: 'Default copy', exact: true }).click();
  await expect(settings.getByLabel('Accent color hex', { exact: true })).toHaveValue('#aabbcc');
});

test('theme picker aligns the arrow and supports keyboard, dismissal and small windows', async ({
  page,
}) => {
  await installWorkspaceMock(page);
  await page.goto('/e2e/workspace.html');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  const picker = settings.getByRole('combobox', { name: 'Theme', exact: true });
  await picker.scrollIntoViewIfNeeded();
  const geometry = await picker.evaluate((trigger) => {
    const arrow = trigger.querySelector('.theme-picker-chevron')!;
    const triggerBounds = trigger.getBoundingClientRect();
    const arrowBounds = arrow.getBoundingClientRect();
    return {
      centerOffset: Math.abs(
        arrowBounds.y + arrowBounds.height / 2 - triggerBounds.y - triggerBounds.height / 2
      ),
      rightGap: triggerBounds.right - arrowBounds.right,
    };
  });
  expect(geometry.centerOffset).toBeLessThan(1);
  expect(geometry.rightGap).toBeGreaterThanOrEqual(12);
  await picker.focus();
  await page.keyboard.press('ArrowDown');
  await expect(settings.getByRole('listbox')).toBeVisible();
  await page.keyboard.type('ocean');
  await page.keyboard.press('Enter');
  await expect(picker).toHaveText('Ocean');
  await expect(picker).toBeFocused();
  await picker.click();
  await expect(settings.getByRole('option', { name: 'Ocean', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  const triggerAfterSelection = (await picker.boundingBox())!;
  const navigation = (await settings.locator('.appearance-navigation').boundingBox())!;
  expect(triggerAfterSelection.y).toBeGreaterThanOrEqual(navigation.y + navigation.height);
  await page.screenshot({ path: 'test-results/theme-picker-dark.png' });
  await page.keyboard.press('Escape');
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('listbox')).toHaveCount(0);
  await picker.click();
  await settings.getByLabel('Theme name', { exact: true }).click();
  await expect(settings.getByRole('listbox')).toHaveCount(0);
  await page.setViewportSize({ width: 720, height: 600 });
  await picker.click();
  const menuBounds = (await settings.getByRole('listbox').boundingBox())!;
  expect(menuBounds.y).toBeGreaterThanOrEqual(0);
  expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(600);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(picker).toHaveText('Follow system');
  await expect(settings.getByLabel('Selected theme preview')).toContainText('Follow system');
});
