import { expect, test } from '@playwright/test';
import { installWorkspaceMock } from './helpers/workspaceMock';

test('Source keeps long lines on one row and scrolls horizontally across file and mode switches', async ({ page }) => {
  const longLine = `const message = "${'long code sample '.repeat(30)}";`;
  await installWorkspaceMock(page, 'dark', false, false, undefined, undefined, {
    'Note.md': longLine,
    'Code.ts': longLine,
  });
  await page.goto('/e2e/workspace.html');
  const content = page.locator('.cm-content');
  await expect(content).toContainText(longLine);

  const expectNoWrap = async () => {
    await expect(content).not.toHaveClass(/cm-lineWrapping/);
    const metrics = await page.locator('.cm-line').first().evaluate((line) => {
      const range = document.createRange();
      range.selectNodeContents(line);
      const scroller = line.closest('.cm-scroller')!;
      return {
        rows: new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size,
        canScroll: scroller.scrollWidth > scroller.clientWidth,
      };
    });
    expect(metrics).toEqual({ rows: 1, canScroll: true });
    await page.locator('.cm-scroller').evaluate((scroller) => { scroller.scrollLeft = 200; });
    await expect.poll(() => page.locator('.cm-scroller').evaluate((scroller) => scroller.scrollLeft)).toBeGreaterThan(0);
  };

  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expectNoWrap();
  for (const mode of ['Write', 'Read']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    await expect(content).toHaveClass(/cm-lineWrapping/);
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await expectNoWrap();
  }
  await page.getByRole('treeitem', { name: /^Code/ }).click();
  await expect(page.locator('.cm-source-editor')).toBeVisible();
  await expect(content).toContainText(longLine);
  await expectNoWrap();
});

test('sidebar focus ring stays clear of the toolbar while Source scrolls horizontally', async ({ page }) => {
  await installWorkspaceMock(page, 'dark', false, false,
    `const message = "${'long code sample '.repeat(50)}";`);
  await page.goto('/e2e/workspace.html');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    await page.locator('.cm-scroller').evaluate((scroller) => {
      scroller.scrollLeft = scroller.scrollWidth;
    });
    const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true });
    await page.keyboard.press('Tab');
    await expand.focus();
    await expect(expand).toBeFocused();
    const geometry = await expand.evaluate((button) => {
      const bounds = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      const ring = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      const toolbar = document.querySelector('.workspace-header')!.getBoundingClientRect();
      return {
        visibleFocus: button.matches(':focus-visible'),
        ringRight: bounds.right + Math.max(0, ring),
        toolbarLeft: toolbar.left,
        outerScroll: document.documentElement.scrollLeft,
      };
    });
    expect(geometry.visibleFocus).toBe(true);
    expect(geometry.ringRight).toBeLessThanOrEqual(geometry.toolbarLeft);
    expect(geometry.outerScroll).toBe(0);
    if (cycle === 2) await page.locator('.app-shell-header').screenshot({ path: 'artifacts/ux-islands/sidebar-focus-source.png' });
    await expand.click();
  }
});
