import { expect, test } from '@playwright/test';
import { installWorkspaceMock } from './helpers/workspaceMock';

test.afterEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('the full left edge reveals repeatedly while the pointer moves through the edge and sidebar', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await installWorkspaceMock(page);
  await page.goto('/e2e/workspace.html');
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  const slot = page.locator('.app-shell-sidebar-slot');
  await expect(slot).toHaveCSS('width', '0px');
  const mainWidth = (await page.locator('.app-shell-main').boundingBox())!.width;
  for (const y of [90, 300, 620, 170, 520, 400]) {
    await page.mouse.move(0, y);
    await page.mouse.move(3, y + 3);
    await page.mouse.move(11, y + 1);
    await expect(slot).toHaveClass(/is-hover-open/);
    await page.mouse.move(150, y);
    await expect(slot).not.toHaveAttribute('aria-hidden', 'true');
    await expect(slot.locator('.sidebar')).toHaveCSS('transform', 'none');
    expect((await page.locator('.app-shell-main').boundingBox())!.width).toBeCloseTo(mainWidth, 0);
    await page.mouse.move(950, y);
    await expect(slot).not.toHaveClass(/is-hover-open/);
  }
});

test('hovering reveals a collapsed sidebar without changing document width, and can be disabled', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await installWorkspaceMock(page);
  await page.goto('/e2e/workspace.html');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  const slot = page.locator('.app-shell-sidebar-slot');
  await expect(slot).toHaveAttribute('aria-hidden', 'true');
  await expect(slot).toHaveCSS('width', '0px');
  const width = (await page.locator('.app-shell-main').boundingBox())!.width;
  await page.mouse.move(1, 300);
  await expect(slot).toHaveClass(/is-hover-open/);
  await expect(page.getByRole('button', { name: 'Pin sidebar', exact: true })).toBeVisible();
  expect((await page.locator('.app-shell-main').boundingBox())!.width).toBeCloseTo(width, 0);
  await page.mouse.move(900, 500);
  await expect(slot).not.toHaveClass(/is-hover-open/);
  await page.mouse.move(1, 300);
  await page.getByRole('button', { name: 'Pin sidebar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Collapse sidebar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Outline and backlinks', exact: true }).click();
  const panel = page.locator('.editor-reference-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS('transition-duration', /0\.22s/);
  await page.getByRole('button', { name: 'Close note tools', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Outline and backlinks', exact: true })
  ).toBeFocused();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('tab', { name: 'Behavior', exact: true }).click();
  await dialog.getByLabel('Reveal hidden sidebar on hover', { exact: true }).uncheck();
  await dialog.getByRole('combobox', { name: 'Layout', exact: true }).click();
  await dialog.getByRole('option', { name: 'Full width', exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-note-layout', 'wide');
  await dialog.getByRole('combobox', { name: 'Layout', exact: true }).click();
  await dialog.getByRole('option', { name: 'Centered column', exact: true }).click();
  await dialog.locator('#note-width').evaluate((element: HTMLInputElement) => {
    element.value = '640';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('.editor-workspace .cm-content')).toHaveCSS('max-width', '640px');
  await dialog.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await expect(page.locator('.sidebar-hover-edge')).toHaveCount(0);
});

test('matching words respect independent code and Markdown checkboxes', async ({ page }) => {
  await installWorkspaceMock(
    page,
    'dark',
    false,
    false,
    'alpha alpha alphabet\n\n```cpp\nint alpha = 1;\nalpha++;\n```\n\nomega omega'
  );
  await page.goto('/e2e/workspace.html');
  await page
    .locator('.cm-line')
    .filter({ hasText: /^alpha alpha alphabet$/ })
    .locator('.cm-word-occurrence')
    .first()
    .click();
  await expect(page.locator('.cm-word-occurrence')).toHaveCount(4);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('tab', { name: 'Behavior', exact: true }).click();
  await dialog.getByLabel('Code', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('.cm-word-occurrence')).toHaveCount(2);
  await expect(page.locator('.cm-codeblock-line .cm-word-occurrence')).toHaveCount(0);
  await dialog.screenshot({ path: 'test-results/behavior-settings.png' });
  await dialog.getByLabel('Code', { exact: true }).check();
  await dialog.getByLabel('Markdown', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('.cm-word-occurrence')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .locator('.cm-codeblock-line .cm-token-variable')
    .filter({ hasText: /^alpha$/ })
    .first()
    .click();
  await expect(page.locator('.cm-word-occurrence')).toHaveCount(2);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await dialog.getByRole('tab', { name: 'Behavior', exact: true }).click();
  await dialog.getByLabel('Code', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('.cm-word-occurrence')).toHaveCount(0);
});
