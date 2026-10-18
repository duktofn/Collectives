import { expect, test, type Page } from '@playwright/test';

async function mount(page: Page, doc: string, anchor = doc.length) {
  await page.goto('/e2e/editor-interaction.html');
  await page.evaluate(async ({ doc, anchor }) => {
    const host = document.createElement('div');
    host.id = 'inline-formatting-host';
    host.style.cssText = 'position:fixed;inset:16px;background:var(--bg-primary);z-index:9999';
    document.body.appendChild(host);
    const { mountCodeBlockInteractionFixture } = await import('/src/visual-fixtures/editorCodeBlockFixture.ts');
    const view = mountCodeBlockInteractionFixture(host);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc }, selection: { anchor } });
    view.focus();
  }, { doc, anchor });
  await expect(page.locator('#inline-formatting-host .cm-content')).toBeVisible();
}

async function source(page: Page) {
  return page.evaluate(() => (window as unknown as {
    __codeBlockInteractionView: import('@codemirror/view').EditorView;
  }).__codeBlockInteractionView.state.doc.toString());
}

test('trailing spaces keep active bold styled and Enter closes it before the next list item', async ({ page }) => {
  await mount(page, '# Bugs\n\n1. ');
  await page.keyboard.press('Control+b');
  const text = 'Khi in đậm thì xuống dòng như thế này ';
  await page.keyboard.insertText(text);
  await expect.poll(() => source(page)).toBe(`# Bugs\n\n1. **${text}**`);
  await expect(page.locator('#inline-formatting-host .cm-strong')).toHaveText(`**${text}**`);
  await page.locator('#inline-formatting-host .cm-content').screenshot({ path: 'test-results/inline-formatting-trailing-space.png' });
  await page.keyboard.press('Enter');
  await page.keyboard.type('normal');
  await expect.poll(() => source(page)).toBe(`# Bugs\n\n1. **${text.trimEnd()}**\n2. normal`);
  await expect(page.locator('#inline-formatting-host .cm-strong')).toHaveText(text.trimEnd());
});

test('arrowing past a draft closer preserves bold and puts its trailing space outside', async ({ page }) => {
  await mount(page, '**bold **', 7);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('normal');
  await expect.poll(() => source(page)).toBe('**bold** normal');
  await expect(page.locator('#inline-formatting-host .cm-strong')).toHaveText('bold');
});

test('Enter at the end of bold content starts an unformatted line without moving the closing marker down', async ({ page }) => {
  await mount(page, '**bold**', 6);
  await page.keyboard.press('Enter');
  await page.keyboard.type('normal');
  await expect.poll(() => source(page)).toBe('**bold**\nnormal');
});

for (const prefix of ['', '1. ', '- ']) {
  test(`empty bold stays visible and arrow keys exit formatting after ${JSON.stringify(prefix)}`, async ({ page }) => {
    await mount(page, prefix);
    await page.keyboard.press('Control+b');
    const content = page.locator('#inline-formatting-host .cm-content');
    await expect(content).toHaveText(prefix + '****');
    await expect(content.locator('.cm-hr')).toHaveCount(0);
    await page.keyboard.type(' ');
    await expect(content).toHaveText(prefix + '** **');
    await expect(content.locator('.cm-hr')).toHaveCount(0);
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText('Nội dung đậm');
    await expect(content.locator('.cm-strong')).toHaveText('**Nội dung đậm**');
    await page.screenshot({ path: `test-results/inline-formatting-active-${prefix === '' ? 'plain' : prefix === '1. ' ? 'ordered' : 'unordered'}.png` });
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type(' plain');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Next line');
    const continuation = prefix === '1. ' ? '2. ' : prefix;
    await expect.poll(() => source(page)).toBe(`${prefix}**Nội dung đậm** plain\n${continuation}Next line`);
    await expect(content.locator('.cm-strong')).toHaveText('Nội dung đậm');
    await page.screenshot({ path: `test-results/inline-formatting-${prefix === '' ? 'plain' : prefix === '1. ' ? 'ordered' : 'unordered'}.png` });
  });
}

for (const { shortcut, marker, css } of [
  { shortcut: 'Control+i', marker: '*', css: '.cm-emphasis' },
  { shortcut: 'Control+Shift+s', marker: '~~', css: '.cm-strikethrough' },
  { shortcut: null, marker: '`', css: '.cm-inline-code' },
]) {
  test(`${css} exposes active delimiters and allows ordinary text after the closer`, async ({ page }) => {
    await mount(page, 'Text ');
    if (shortcut) await page.keyboard.press(shortcut);
    else await page.keyboard.type(marker);
    const trailing = css !== '.cm-inline-code' ? ' ' : '';
    await page.keyboard.type('formatted' + trailing);
    const styled = page.locator('#inline-formatting-host').locator(css);
    await expect(styled).toHaveText(`${marker}formatted${trailing}${marker}`);
    for (let i = 0; i < marker.length; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.type(trailing ? 'normal' : ' normal');
    await expect.poll(() => source(page)).toBe(`Text ${marker}formatted${marker} normal`);
    await expect(styled).toHaveText('formatted');
  });
}

test('typing the bold closing markers exits without duplicating them', async ({ page }) => {
  await mount(page, '1. ');
  await page.keyboard.type('**bold**');
  await page.keyboard.press('Enter');
  await page.keyboard.type('normal');
  await expect.poll(() => source(page)).toBe('1. **bold**\n2. normal');
});

test('arrow keys can also leave through the opening bold marker', async ({ page }) => {
  await mount(page, '**bold**', 2);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('Before ');
  await expect.poll(() => source(page)).toBe('Before **bold**');
});

test('clicking rendered bold reveals editable markers without moving the insertion position', async ({ page }) => {
  await mount(page, 'Before **bold text** after.');
  const point = await page.locator('#inline-formatting-host .cm-strong').evaluate((element) => {
    const text = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE)!;
    const range = document.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 3);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + 0.1, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#inline-formatting-host .cm-strong')).toHaveText('**bold text**');
  await page.keyboard.insertText('X');
  await expect.poll(() => source(page)).toBe('Before **boXld text** after.');
});
