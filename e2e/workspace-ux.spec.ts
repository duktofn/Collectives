import { expect, test } from '@playwright/test';
import { installWorkspaceMock } from './helpers/workspaceMock';

for (const theme of ['dark', 'light']) {
  test(`workspace hierarchy and note tools in ${theme}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await installWorkspaceMock(page, theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/e2e/workspace.html');
    await expect(page.locator('.cm-content')).toContainText('Product direction');
    await expect(page.getByRole('button', { name: 'Quick Open', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Write', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const status = await page.locator('.app-shell-activity').boundingBox();
    expect(status!.y).toBeGreaterThan(850);
    await page.getByRole('button', { name: 'Read', exact: true }).click();
    await expect(page.locator('.cm-heading-1')).toHaveText('Product direction');
    await page.screenshot({ path: `artifacts/ux-polish/after-${theme}.png` });
    await page.getByRole('button', { name: 'Outline and backlinks', exact: true }).click();
    const outline = page.getByRole('tab', { name: 'Outline', exact: true });
    await outline.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Backlinks', exact: true })).toBeFocused();
    await expect(page.getByRole('tabpanel')).toHaveAccessibleName('Backlinks');
    await page.keyboard.press('Home');
    await expect(outline).toBeFocused();
    await expect(page.locator('.editor-outline-item')).toHaveCount(4);
    await page.screenshot({ path: `artifacts/ux-polish/outline-${theme}.png` });
    await page.getByRole('button', { name: 'Close note tools', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Outline and backlinks', exact: true })
    ).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test('small workspace keeps toolbar and all files reachable', async ({ page }) => {
  await installWorkspaceMock(page);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto('/e2e/workspace.html');
  await expect(page.locator('.cm-content')).toContainText('Product direction');
  const context = await page.locator('.editor-document-context').boundingBox();
  const actions = await page.locator('.editor-actions').boundingBox();
  expect(actions!.x + actions!.width).toBeLessThanOrEqual(801);
  expect(actions!.y).toBeGreaterThanOrEqual(context!.y + context!.height);
  await page.locator('.tree-content-container').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.getByRole('treeitem', { name: /Research note 26/ })).toBeInViewport();
  await page.screenshot({ path: 'artifacts/ux-polish/after-compact.png' });
  await page.getByRole('button', { name: 'Outline and backlinks', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Outline' })).toBeVisible();
  const panel = await page.locator('.editor-reference-panel').boundingBox();
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(801);
  await page.getByRole('button', { name: 'Close note tools', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Expand sidebar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Quick Open', exact: true })).toBeVisible();
});

test('Quick Open scrolls keyboard selection and restores trigger focus', async ({ page }) => {
  await installWorkspaceMock(page);
  await page.goto('/e2e/workspace.html');
  const trigger = page.getByRole('button', { name: 'Quick Open', exact: true });
  await trigger.click();
  const input = page.getByRole('combobox', { name: 'Search note names' });
  await expect(input).toBeFocused();
  await input.fill('Research');
  await expect(page.getByRole('option')).toHaveCount(27);
  for (let i = 0; i < 23; i++) await input.press('ArrowDown');
  await expect(page.getByRole('option', { selected: true })).toBeInViewport();
  await page.screenshot({ path: 'artifacts/ux-polish/quick-open.png' });
  await input.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  // Direct activation must open that row, even without a mouseenter event.
  const row = page.getByRole('option').nth(2);
  const rowName = await row.locator('.search-dialog-option-name').innerText();
  await row.dispatchEvent('click');
  await expect(page.locator('.editor-file-name')).toHaveText(rowName);
});

test('new note proposes the current folder and exposes an explicit change action', async ({
  page,
}) => {
  await installWorkspaceMock(page);
  await page.goto('/e2e/workspace.html');
  await expect(page.locator('.cm-content')).toContainText('Product direction');
  await page
    .getByRole('button', { name: /New note/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Create a new note' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.note-save-location code')).toHaveText('D:/Sample/Knowledge');
  expect(
    await page.evaluate(
      () =>
        (window as any).__workspaceCommands.filter((cmd: string) => cmd === 'plugin:dialog|open')
          .length
    )
  ).toBe(0);
  await dialog.getByRole('button', { name: 'Change…' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__workspaceCommands.filter((cmd: string) => cmd === 'plugin:dialog|open')
            .length
      )
    )
    .toBe(1);
  await page.screenshot({ path: 'artifacts/ux-polish/new-note.png' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).__workspaceCommands.includes('create_file'))
  ).toBe(false);
});

test('toolbar menus support keyboard dismissal and search can be opened by a button', async ({
  page,
}) => {
  await installWorkspaceMock(page);
  await page.goto('/e2e/workspace.html');
  const more = page.getByRole('button', { name: 'More note actions', exact: true });
  await more.click();
  await expect(page.getByRole('menuitem', { name: 'Copy path' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Copy WikiLink' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await more.click();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(
    await page.evaluate(() => Boolean(document.activeElement?.closest('.app-shell-main')))
  ).toBe(true);
  await more.click();
  await page.locator('.cm-content').click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('button', { name: 'Search note contents', exact: true }).click();
  const input = page.getByRole('combobox', { name: 'Search note contents' });
  await expect(input).toBeFocused();
  await input.fill('navigation');
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.screenshot({ path: 'artifacts/ux-polish/content-search.png' });
  await page.getByRole('button', { name: 'Close content search', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('empty state has clear actions and works in light theme', async ({ page }) => {
  await installWorkspaceMock(page, 'light', true);
  await page.goto('/e2e/workspace.html');
  await expect(page.getByRole('heading', { name: 'Welcome to Collectives' })).toBeVisible();
  await expect(page.locator('.empty-workspace .btn-primary')).toHaveCount(1);
  await page.screenshot({ path: 'artifacts/ux-polish/empty-light.png' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/ux-polish/settings-light.png' });
});

test('collection overview opens a note without recent or pinned features', async ({ page }) => {
  await installWorkspaceMock(page, 'dark', false, true);
  await page.goto('/e2e/workspace.html');
  await expect(
    page.getByRole('heading', { name: 'Personal knowledge', exact: true })
  ).toBeVisible();
  await expect(page.locator('.workspace-home-note')).toHaveCount(5);
  await expect(page.getByText('Recent', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Pinned', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pin note', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/ux-polish/workspace-home.png' });
  await page.locator('.workspace-home-note').nth(1).click();
  await expect(page.locator('.editor-file-name')).toHaveText('Research and references');
});

test('collection can be renamed in the picker with validation', async ({ page }) => {
  await installWorkspaceMock(page);
  await page.goto('/e2e/workspace.html');
  const picker = page.getByRole('button', { name: 'Choose collection' });
  await picker.click();
  await page.getByRole('button', { name: 'Rename collection', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Collection name' });
  await expect(input).toBeFocused();
  await input.fill(' ');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(
    page.getByRole('form', { name: 'Rename collection' }).getByRole('alert')
  ).toContainText('Enter a collection name');
  await input.fill('Writing workspace');
  await input.press('Enter');
  await expect(picker).toContainText('Writing workspace');
  await expect(page.locator('.editor-breadcrumb')).toContainText('Writing workspace');
  await page.screenshot({ path: 'artifacts/ux-islands/collection-picker.png' });
});

test('settings island animates in and out and honors reduced motion', async ({ page }) => {
  await installWorkspaceMock(page, 'light');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/e2e/workspace.html');
  const trigger = page.getByRole('button', { name: 'Settings', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => getComputedStyle(el).animationName)).toBe(
    'settings-island-in'
  );
  await dialog.evaluate(el => Promise.all(el.parentElement!.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
  await page.screenshot({ path: 'artifacts/ux-islands/settings-light.png' });
  await page.locator('#settings-appearance-panel select').first().selectOption('Georgia');
  await page.getByRole('button', { name: 'Cancel', exact: true }).dispatchEvent('click');
  const exitSafety = await page.evaluate(() => {
    const apply = Array.from(document.querySelectorAll<HTMLButtonElement>('.theme-panel-footer button')).find(button => button.textContent?.trim() === 'Apply');
    const disabled = apply?.disabled;
    apply?.click();
    return { disabled, saved: (window as any).__workspaceCommands.includes('save_settings') };
  });
  expect(exitSafety).toEqual({ disabled: true, saved: false });
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await trigger.click();
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(dialog).toHaveCount(0);
});
