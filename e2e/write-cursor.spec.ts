import { expect, test, type Page } from '@playwright/test';

async function mount(page: Page, width = 720) {
  await page.goto('/e2e/editor-interaction.html', { waitUntil: 'commit' });
  await page.evaluate(async (width) => {
    const host = document.createElement('div');
    host.id = 'write-cursor-host';
    host.className = 'editor-workspace';
    host.style.cssText = `position:fixed;inset:16px auto auto 16px;width:${width}px;height:640px;overflow:hidden;background:var(--bg-primary);`;
    document.body.appendChild(host);
    const fixture = await import('/src/visual-fixtures/writeCursorFixture.ts');
    fixture.mountWriteCursorFixture(host);
  }, width);
  await expect(page.locator('#write-cursor-host .cm-content')).toBeVisible();
}

async function point(page: Page, phrase: string, offset: number) {
  return page.evaluate(
    ({ phrase, offset }) => {
      const line = Array.from(
        document.querySelectorAll<HTMLElement>('#write-cursor-host .cm-line')
      ).find((el) => el.textContent?.includes(phrase));
      if (!line) throw new Error(`Missing rendered phrase ${phrase}`);
      let remaining = line.textContent!.indexOf(phrase) + offset;
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (remaining < (node.textContent?.length ?? 0)) {
          const range = document.createRange();
          range.setStart(node, remaining);
          range.setEnd(node, remaining + 1);
          const box = range.getBoundingClientRect();
          return { x: box.left + 0.15, y: box.top + box.height / 2 };
        }
        remaining -= node.textContent?.length ?? 0;
      }
      throw new Error('No rendered text at target offset');
    },
    { phrase, offset }
  );
}

for (const [phrase, offset, width] of [
  ['rendered heading', 3, 720],
  ['bold words', 3, 720],
  ['followed by', 3, 720],
  ['final tail', 3, 400],
] as const) {
  test(`Write click inserts at rendered ${phrase}`, async ({ page }) => {
    await mount(page, width);
    const target = await point(page, phrase, offset);
    await page.mouse.click(target.x, target.y);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    const snapshot = await page.evaluate(
      ({ phrase, offset }) => {
        const view = (window as any).__writeCursorView;
        const caret = view.coordsAtPos(view.state.selection.main.head);
        return {
          head: view.state.selection.main.head,
          expected: view.state.doc.toString().indexOf(phrase) + offset,
          before: view.state.doc.toString(),
          caret: { x: caret.left, y: (caret.top + caret.bottom) / 2 },
        };
      },
      { phrase, offset }
    );
    expect(snapshot.head).toBe(snapshot.expected);
    expect(Math.abs(snapshot.caret.x - target.x)).toBeLessThan(3);
    expect(Math.abs(snapshot.caret.y - target.y)).toBeLessThan(3);
    await page.keyboard.type('|');
    const after = await page.evaluate(() => (window as any).__writeCursorView.state.doc.toString());
    expect(after).toBe(
      snapshot.before.slice(0, snapshot.expected) + '|' + snapshot.before.slice(snapshot.expected)
    );
  });
}
