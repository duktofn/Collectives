import { expect, test, type Page } from '@playwright/test';
import { installWorkspaceMock } from './helpers/workspaceMock';

async function doc(page: Page) {
  return page.evaluate(async () => {
    const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
    return viewForElement(
      document.querySelector('.editor-workspace > .cm-editor .cm-content') as HTMLElement
    )!.state.doc.toString();
  });
}

async function placeCursor(page: Page, select = false) {
  await page.evaluate(async (select) => {
    const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
    const view = viewForElement(
      document.querySelector('.editor-workspace > .cm-editor .cm-content') as HTMLElement
    )!;
    view.dispatch({
      selection: { anchor: select ? 0 : view.state.doc.length, head: view.state.doc.length },
    });
    view.focus();
  }, select);
}

test.beforeEach(async ({ page }) => {
  await installWorkspaceMock(page, 'dark', false, false, 'A sample note\n\n');
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as unknown as { __copied: string }).__copied = value;
        },
        readText: async () => (window as unknown as { __copied?: string }).__copied ?? '',
      },
    })
  );
  await page.goto('/e2e/workspace.html');
  await expect(page.locator('.cm-content')).toContainText('A sample note');
});

test('editor reaches sidebar bottom, mode icons float inside and unsaved dot follows saves', async ({
  page,
}) => {
  await expect(page.locator('.app-shell-activity')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Insert Markdown template', exact: true })
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More note actions', exact: true })).toHaveCount(0);
  const sidebar = (await page.locator('.sidebar').boundingBox())!;
  const editor = (await page.locator('.app-shell-body').boundingBox())!;
  expect(Math.abs(sidebar.y + sidebar.height - editor.y - editor.height)).toBeLessThan(2);
  const modes = (await page.getByRole('group', { name: 'Editor mode' }).boundingBox())!;
  expect(modes.y + modes.height).toBeLessThan(editor.y + editor.height);
  expect(modes.y).toBeGreaterThan(editor.y + editor.height - 90);
  await expect(page.getByRole('button', { name: 'Write', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await placeCursor(page);
  await page.keyboard.type('Unsaved text');
  await expect(page.locator('.editor-file-name .editor-unsaved-dot')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page.locator('.editor-unsaved-dot')).toHaveCount(0);
  await page.getByRole('button', { name: 'Write', exact: true }).click();
  await page.screenshot({ path: 'test-results/editor-floating-controls.png' });
});

test('right click provides only requested actions and heading submenus work with keyboard and pointer', async ({
  page,
}) => {
  await placeCursor(page);
  await page
    .locator('.cm-line')
    .first()
    .click({ button: 'right', position: { x: 30, y: 10 } });
  await expect(
    page.getByRole('menu', { name: 'Context actions', exact: true }).getByRole('menuitem')
  ).toHaveText([
    'Search in notes',
    'Copy',
    'Cut',
    'Paste',
    'Select All',
    'Heading',
    'Table',
    'Chart',
  ]);
  await expect(page.getByRole('menuitem', { name: 'Copy', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Cut', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Paste', exact: true })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Heading', exact: true }).hover();
  await expect(page.getByRole('menu', { name: 'Heading', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Header 2', exact: true }).click();
  await expect.poll(() => doc(page)).toContain('## A sample note');
  await page.keyboard.press('Control+z');
  await placeCursor(page, true);
  await page
    .locator('.cm-line')
    .first()
    .click({ button: 'right', position: { x: 40, y: 10 } });
  await expect(
    page.getByRole('menu', { name: 'Context actions', exact: true }).getByRole('menuitem')
  ).toHaveText([
    'Search in notes',
    'Copy',
    'Cut',
    'Paste',
    'Select All',
    'Heading',
    'Table',
    'Chart',
  ]);
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __copied: string }).__copied))
    .toBe('A sample note\n\n');
  await placeCursor(page, true);
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Search in notes', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Search note contents', exact: true })
  ).toBeFocused();
  await expect(
    page.getByRole('combobox', { name: 'Search note contents', exact: true })
  ).toHaveValue('A sample note');
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-search')).toHaveCount(0);
  await placeCursor(page, true);
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Cut', exact: true }).click();
  await expect.poll(() => doc(page)).toBe('');
  await placeCursor(page);
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Paste', exact: true })).toBeEnabled();
  await page.getByRole('menuitem', { name: 'Paste', exact: true }).click();
  await expect.poll(() => doc(page)).toBe('A sample note\n\n');
  await page.keyboard.press('Control+z');
  await expect.poll(() => doc(page)).toBe('');
  await page.keyboard.press('Control+z');
  await expect.poll(() => doc(page)).toBe('A sample note\n\n');
  await placeCursor(page);
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Heading', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: 'Header 1', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('menuitem', { name: 'Heading', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('chart parent inserts bar, submenu inserts every chart kind, table and sidebar copy path work', async ({
  page,
}) => {
  for (const kind of ['Bar', 'Line', 'Area', 'Pie', 'Doughnut']) {
    await placeCursor(page);
    await page.keyboard.press('Shift+F10');
    const chart = page.getByRole('menuitem', { name: 'Chart', exact: true });
    if (kind === 'Bar') await chart.click();
    else {
      await chart.hover();
      if (kind === 'Pie') {
        await expect(page.getByRole('menu', { name: 'Chart', exact: true })).toHaveCSS(
          'opacity',
          '1'
        );
        await page.screenshot({ path: 'test-results/editor-chart-context-menu.png' });
      }
      await page.getByRole('menuitem', { name: kind, exact: true }).click();
    }
    await expect.poll(() => doc(page)).toContain(`type: ${kind.toLowerCase()}`);
    await expect(page.locator('.cm-chart-widget-container')).toHaveAttribute(
      'data-chart-state',
      'ready'
    );
    await page.keyboard.press('Control+z');
    await expect.poll(() => doc(page)).toBe('A sample note\n\n');
  }
  await placeCursor(page);
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Table', exact: true }).click();
  await expect.poll(() => doc(page)).toContain('| Column 1 | Column 2 |');
  const file = page.getByRole('treeitem', { name: 'Product direction', exact: true });
  await file.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy path', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __copied: string }).__copied))
    .toBe('D:/Sample/Knowledge/Product direction.md');
});

test('Read mode blocks editing, and a failed clipboard write never cuts the selected text', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await placeCursor(page, true);
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Copy', exact: true })).toBeEnabled();
  await expect(page.getByRole('menuitem', { name: 'Cut', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Paste', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Heading', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Table', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Chart', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Write', exact: true }).click();
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Clipboard denied');
        },
      },
    })
  );
  await placeCursor(page, true);
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Cut', exact: true }).click();
  await expect(page.locator('.editor-context-notice')).toHaveText(
    'Could not access the clipboard.'
  );
  await expect.poll(() => doc(page)).toBe('A sample note\n\n');
});

test('core note dialogs and context search open without fetching a deferred dialog module', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/src/components/search/*.tsx*', (route) => route.abort());
  await page.getByRole('button', { name: /New note/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'Create a new note', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Quick Open', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Search note names', exact: true })
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Search note contents', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Search note contents', exact: true })
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await placeCursor(page, true);
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Search in notes', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Search note contents', exact: true })
  ).toHaveValue('A sample note');
  await expect(page.getByText('Unhandled application error', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('editor scrollbar stays slim with room above and below the rounded surface', async ({ page }) => {
  await page.evaluate(async () => {
    const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
    const view = viewForElement(document.querySelector('.editor-workspace .cm-content') as HTMLElement)!;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: Array.from({ length: 100 }, (_, i) => `Paragraph ${i + 1}. A longer note for checking the scrollbar.\n`).join('\n') } });
    view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
  });
  const scroller = page.locator('.editor-workspace > .cm-editor > .cm-scroller');
  const scrollbar = page.getByRole('scrollbar', { name: 'Scroll document', exact: true });
  await expect(scrollbar).toBeVisible();
  await expect(scroller).toHaveCSS('scrollbar-width', 'none');
  const paneBox = (await page.locator('.editor-writing-pane').boundingBox())!;
  const trackBox = (await scrollbar.boundingBox())!;
  const thumb = scrollbar.locator('.editor-scrollbar-thumb');
  await expect(thumb).toHaveCSS('width', '5px');
  expect(trackBox.y - paneBox.y).toBeGreaterThanOrEqual(24);
  expect(paneBox.y + paneBox.height - trackBox.y - trackBox.height).toBeGreaterThanOrEqual(24);
  const content = await doc(page);
  await scrollbar.focus();
  await page.keyboard.press('Home');
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBe(0);
  const thumbBox = (await thumb.boundingBox())!;
  await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + 4);
  await page.mouse.down();
  await page.mouse.move(thumbBox.x + thumbBox.width / 2, trackBox.y + trackBox.height - 4, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => scroller.evaluate(el => el.scrollTop / (el.scrollHeight - el.clientHeight))).toBeGreaterThan(0.95);
  expect(await doc(page)).toBe(content);
  await scrollbar.evaluate(el => el.blur());
  await page.screenshot({ path: 'test-results/editor-slim-scrollbar.png' });
});
