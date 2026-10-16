import { expect, test, type Page } from '@playwright/test';
import { installWorkspaceMock } from './helpers/workspaceMock';

const json = '{"name":"Sample","count":42,"items":[{"enabled":true}]}';
const html =
  '<main><h1>Title</h1><p class="lead">Hello <strong>world</strong></p><script>window.__htmlExecuted=true;</script></main>';
async function source(page: Page) {
  return page.evaluate(async () => {
    const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
    return viewForElement(
      document.querySelector('.cm-content') as HTMLElement
    )!.state.doc.toString();
  });
}

for (const theme of ['dark', 'light'])
  test(`JSON and HTML are highlighted and formatting can be undone in ${theme}`, async ({
    page,
  }) => {
    await installWorkspaceMock(page, theme, false, false, undefined, undefined, {
      'settings.JSON': json,
      'index.HTML': html,
      README: '# Raw text',
    });
    await page.goto('/e2e/workspace.html');
    await expect(page.locator('.cm-source-editor')).toBeVisible();
    await expect(page.locator('.cm-token-property').first()).toBeVisible();
    await expect(page.locator('.cm-token-number').first()).toBeVisible();
    const colors = await page.locator('.cm-source-editor').evaluate((element) => ({
      property: getComputedStyle(element.querySelector('.cm-token-property')!).color,
      string: getComputedStyle(element.querySelector('.cm-token-string')!).color,
    }));
    expect(colors.property).not.toBe(colors.string);
    expect(await source(page)).toBe(json);
    await expect(page.locator('.cm-lineNumbers')).toBeVisible();
    await page.getByRole('button', { name: 'Format document', exact: true }).click();
    await expect.poll(() => source(page)).toContain('\n');
    expect(JSON.parse(await source(page))).toEqual(JSON.parse(json));
    expect((await source(page)).split('\n').length).toBeGreaterThan(3);
    await page
      .locator('.cm-source-editor')
      .screenshot({ path: `test-results/source-json-${theme}.png` });
    await page.keyboard.press('Control+z');
    await expect.poll(() => source(page)).toBe(json);
    await page.getByRole('treeitem', { name: 'index.HTML', exact: true }).click();
    await expect(page.locator('.cm-token-type').first()).toBeVisible();
    expect(await source(page)).toBe(html);
    expect(await page.evaluate(() => (window as any).__htmlExecuted)).toBeUndefined();
    await page.getByRole('button', { name: 'Format document', exact: true }).click();
    await expect.poll(() => source(page)).toContain('\n');
    await page
      .locator('.cm-source-editor')
      .screenshot({ path: `test-results/source-html-${theme}.png` });
    await page.keyboard.press('Control+z');
    await expect.poll(() => source(page)).toBe(html);
    await page.getByRole('treeitem', { name: 'README', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText('# Raw text');
    await expect(page.locator('.cm-heading')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Format document', exact: true })).toHaveCount(0);
  });

test('fenced C++, C# and JSON code has syntax colors and stays editable', async ({ page }) => {
  await installWorkspaceMock(
    page,
    'dark',
    false,
    false,
    '# Code\n\n```cpp\nint main() { return 42; }\n```\n\n```csharp\npublic class Example { string value = "hello"; }\n```\n\n```json\n{"count": 3}\n```\n\nAfter code.'
  );
  await page.goto('/e2e/workspace.html');
  await expect(
    page.locator('.cm-codeblock-language-name').filter({ hasText: 'C++' })
  ).toBeVisible();
  await expect(page.locator('.cm-codeblock-line .cm-token-keyword').first()).toBeVisible();
  await expect(page.locator('.cm-codeblock-line .cm-token-number').first()).toBeVisible();
  await expect(page.locator('.cm-codeblock-line .cm-token-string').first()).toBeVisible();
  const before = await source(page);
  await page.screenshot({ path: 'test-results/code-syntax-dark.png' });
  const line = page.locator('.cm-codeblock-line').filter({ hasText: 'int main()' });
  await line.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' // edited');
  await expect
    .poll(() => source(page))
    .toBe(before.replace('int main() { return 42; }', 'int main() { return 42; } // edited'));
});
