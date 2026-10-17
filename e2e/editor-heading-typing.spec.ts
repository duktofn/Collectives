import { expect, test, type Page } from '@playwright/test';
import { installWorkspaceMock } from './helpers/workspaceMock';

async function source(page: Page) {
  return page.evaluate(async () => {
    const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
    return viewForElement(
      document.querySelector('.cm-content') as HTMLElement
    )!.state.doc.toString();
  });
}

for (const level of [1, 2, 3, 4, 5, 6])
  test(`typing H${level} keeps text after the heading marker`, async ({ page }) => {
    await installWorkspaceMock(page, 'dark', false, false, 'Before heading.\n\n');
    await page.goto('/e2e/workspace.html');
    await expect(page.locator('.cm-content')).toContainText('Before heading.');
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('#'.repeat(level) + ' ', { delay: 60 });
    await page.keyboard.type('Heading text', { delay: 50 });
    await expect
      .poll(() => source(page))
      .toBe(`Before heading.\n\n${'#'.repeat(level)} Heading text`);
    await expect(page.locator(`.cm-heading-${level}`)).toHaveText('Heading text');
    // Deleting the whole title leaves an editable heading, including native text insertion.
    for (let count = 0; count < 'Heading text'.length; count++)
      await page.keyboard.press('Backspace');
    await page.keyboard.insertText('Tiêu đề');
    await expect.poll(() => source(page)).toBe(`Before heading.\n\n${'#'.repeat(level)} Tiêu đề`);
    await expect(page.locator(`.cm-heading-${level}`)).toHaveText('Tiêu đề');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Next paragraph.');
    await expect
      .poll(() => source(page))
      .toBe(`Before heading.\n\n${'#'.repeat(level)} Tiêu đề\nNext paragraph.`);
    for (const mode of ['Source', 'Read', 'Write']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      if (mode === 'Source') await expect(page.locator('.cm-heading')).toHaveCount(0);
      else await expect(page.locator(`.cm-heading-${level}`)).toHaveText('Tiêu đề');
    }
  });

test('headings render on first open and repeated file switches in a long document', async ({ page }) => {
  await installWorkspaceMock(page, 'dark', false, false, undefined, undefined, {
    'First.md': '# First heading\n\nA short note.',
    'Long.md': 'Paragraph before the heading.\n\n'.repeat(500) + '## Late heading\n\nEnd of note.',
  });
  await page.goto('/e2e/workspace.html');
  await expect(page.locator('.cm-heading-1')).toHaveText('First heading');
  for (let visit = 0; visit < 3; visit++) {
    await page.getByRole('treeitem', { name: /^Long/ }).click();
    await expect(page.locator('.cm-content')).toContainText('Paragraph before the heading.');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+End');
    await expect(page.locator('.cm-heading-2')).toHaveText('Late heading');
    await page.getByRole('treeitem', { name: /^First/ }).click();
    await expect(page.locator('.cm-heading-1')).toHaveText('First heading');
  }
});

test('Markdown insertion is disabled inside code and can be reopened outside it', async ({
  page,
}) => {
  await installWorkspaceMock(page, 'dark', false, false, '# Heading\n\n```text\ncode\n```');
  await page.goto('/e2e/workspace.html');
  await expect(page.locator('.cm-content')).toContainText('Heading');
  await page.evaluate(async () => {
    const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
    const view = viewForElement(document.querySelector('.cm-content') as HTMLElement)!;
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('code') + 2 } });
    view.focus();
  });
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Heading', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Heading', exact: true })).toBeEnabled();
});
