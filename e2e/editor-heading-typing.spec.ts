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
    // Deleting the whole title leaves an editable heading, including native text insertion.
    for (let count = 0; count < 'Heading text'.length; count++)
      await page.keyboard.press('Backspace');
    await page.keyboard.insertText('Tiêu đề');
    await expect.poll(() => source(page)).toBe(`Before heading.\n\n${'#'.repeat(level)} Tiêu đề`);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Next paragraph.');
    await expect
      .poll(() => source(page))
      .toBe(`Before heading.\n\n${'#'.repeat(level)} Tiêu đề\nNext paragraph.`);
  });

test('an insertion warning cannot cover a reopened menu', async ({ page }) => {
  await installWorkspaceMock(page, 'dark', false, false, '# Heading\n\n```text\ncode\n```');
  await page.goto('/e2e/workspace.html');
  await expect(page.locator('.cm-content')).toContainText('Heading');
  await page.evaluate(async () => {
    const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
    const view = viewForElement(document.querySelector('.cm-content') as HTMLElement)!;
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('code') + 2 } });
    view.focus();
  });
  const trigger = page.getByRole('button', { name: 'Insert Markdown template', exact: true });
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Heading', exact: true }).click();
  await expect(page.locator('.editor-copy-toast')).toBeVisible();
  await trigger.click();
  await expect(page.locator('.editor-copy-toast')).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Heading', exact: true })).toBeVisible();
});
