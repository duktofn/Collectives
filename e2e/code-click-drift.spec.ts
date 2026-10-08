import { expect, test, type Page } from '@playwright/test';
import { installWorkspaceMock } from './helpers/workspaceMock';

const document = Array.from({ length: 60 }, (_, block) =>
  [
    `## Section ${block}`,
    '',
    `Text before block ${block}.`,
    '',
    '```typescript',
    ...Array.from({ length: 5 }, (_, line) => `const block_${block}_line_${line} = ${line};`),
    '```',
    '',
    `Text after block ${block}.`,
    '',
  ].join('\n')
).join('\n');

async function view(page: Page, phrase: string, scroll = false) {
  return page.evaluate(
    async ({ phrase, scroll }) => {
      const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
      const editor = viewForElement(
        globalThis.document.querySelector('.editor-workspace .cm-content') as HTMLElement
      )!;
      const from = editor.state.doc.toString().indexOf(phrase);
      if (scroll) {
        const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
        editor.dispatch({ effects: EditorView.scrollIntoView(from, { y: 'center' }) });
      }
      return from;
    },
    { phrase, scroll }
  );
}

async function point(page: Page, phrase: string, offset = 9) {
  await expect(page.locator('.cm-codeblock-line').filter({ hasText: phrase })).toBeVisible();
  await expect(page.locator('.cm-codeblock-line').filter({ hasText: phrase })).toBeInViewport();
  return page.evaluate(
    ({ phrase, offset }) => {
      const line = Array.from(globalThis.document.querySelectorAll<HTMLElement>('.cm-line')).find(
        (el) => el.textContent?.includes(phrase)
      )!;
      let remaining = line.textContent!.indexOf(phrase) + offset;
      const walker = globalThis.document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (remaining < (node.textContent?.length ?? 0)) {
          const range = globalThis.document.createRange();
          range.setStart(node, remaining);
          range.setEnd(node, remaining + 1);
          const rect = range.getBoundingClientRect();
          return { x: rect.left + rect.width * 0.2, y: rect.top + rect.height / 2 };
        }
        remaining -= node.textContent?.length ?? 0;
      }
      throw new Error('Missing code text');
    },
    { phrase, offset }
  );
}

for (const [collapsed, fontScale] of [
  [false, 1],
  [true, 1],
  [true, 1.3],
] as const) {
  test(`repeated code clicks stay stable, sidebar collapsed=${collapsed}, font=${fontScale}`, async ({
    page,
  }) => {
    await installWorkspaceMock(page, 'dark', false, false, document, {
      fontScale,
      fontMono: 'Consolas',
    });
    await page.setViewportSize({ width: 1100, height: 720 });
    await page.goto('/e2e/workspace.html');
    await expect(page.locator('.cm-content')).toContainText('Section 0');
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(globalThis.document.documentElement)
            .getPropertyValue('--font-scale')
            .trim()
        )
      )
      .toBe(String(fontScale));
    if (collapsed) await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    if (collapsed) {
      const menu = page.getByRole('button', { name: 'Expand sidebar' });
      const header = await page.locator('.app-shell-header').boundingBox();
      const rect = await menu.boundingBox();
      expect(rect!.x).toBeGreaterThan(header!.x);
      expect(rect!.y).toBeGreaterThan(header!.y);
      expect(await menu.evaluate((element) => getComputedStyle(element).position)).toBe('static');
    }
    for (const block of [0, 2, 8, 18, 30, 48, 59, 8, 0]) {
      const phrase = `const block_${block}_line_2 = 2;`;
      const from = await view(page, phrase, true);
      await point(page, phrase);
      for (let repeat = 0; repeat < 3; repeat++) {
        const offset = [8, 12, 20][repeat];
        const target = await point(page, phrase, offset);
        const before = await page.evaluate(
          ({ x, y }) => ({
            hit: globalThis.document.elementFromPoint(x, y)?.closest('.cm-line')?.textContent,
            scroll: (globalThis.document.querySelector('.cm-scroller') as HTMLElement).scrollTop,
          }),
          target
        );
        await page.mouse.click(target.x, target.y);
        const head = await page.evaluate(async () => {
          const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
          return viewForElement(globalThis.document.querySelector('.cm-content') as HTMLElement)!
            .state.selection.main.head;
        });
        expect(
          head,
          `block ${block}, repeat ${repeat}, point=${JSON.stringify(target)}, before=${JSON.stringify(before)}`
        ).toBe(from + offset);
      }
    }
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await page.getByRole('button', { name: 'Write', exact: true }).click();
    const last = 'const block_8_line_2 = 2;';
    const from = await view(page, last, true);
    const target = await point(page, last, 12);
    await page.mouse.click(target.x, target.y);
    const head = await page.evaluate(async () => {
      const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
      return viewForElement(globalThis.document.querySelector('.cm-content') as HTMLElement)!.state
        .selection.main.head;
    });
    expect(head).toBe(from + 12);
    const unchanged = await page.evaluate(async () => {
      const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
      return viewForElement(
        globalThis.document.querySelector('.cm-content') as HTMLElement
      )!.state.doc.toString();
    });
    expect(unchanged).toBe(document);
    await page.screenshot({
      path: `artifacts/code-drift/collapsed-${collapsed}-font-${fontScale}.png`,
    });
  });
}

test('plain Up/Down/Left/Right code stays clickable after fence expansion', async ({ page }) => {
  const content = '# Directions\n\nIntro.\n\n```\nUp\nDown\nLeft\nRight\n```\n\nAfter the block.\n';
  await installWorkspaceMock(page, 'dark', false, false, content, { fontScale: 1.3 });
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto('/e2e/workspace.html');
  await expect(page.locator('.cm-content')).toContainText('Directions');
  for (let round = 0; round < 3; round++) {
    for (const [phrase, offset] of [
      ['Up', 1],
      ['Down', 2],
      ['Left', 2],
      ['Right', 2],
    ] as const) {
      const from = await view(page, phrase);
      const target = await point(page, phrase, offset);
      await page.mouse.click(target.x, target.y);
      const head = await page.evaluate(async () => {
        const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
        return viewForElement(globalThis.document.querySelector('.cm-content') as HTMLElement)!
          .state.selection.main.head;
      });
      expect(head, `${phrase}, round ${round}`).toBe(from + offset);
    }
  }
  await page.screenshot({ path: 'artifacts/code-drift/plain-code.png' });
});
