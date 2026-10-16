import { expect, test, type Page } from '@playwright/test';
import { installWorkspaceMock } from './helpers/workspaceMock';

const content = Array.from({ length: 60 }, (_, block) =>
  [
    `## Layout section ${block}`,
    '',
    `Paragraph before code ${block}.`,
    '',
    '```typescript',
    ...Array.from({ length: 5 }, (_, row) => `const layout_${block}_row_${row} = ${row};`),
    '```',
    '',
    `Paragraph after code ${block}.`,
    '',
  ].join('\n')
).join('\n');

async function scrollToText(page: Page, phrase: string) {
  await page.evaluate(async (phrase) => {
    const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js');
    const view = viewForElement(document.querySelector('.cm-content') as HTMLElement)!;
    view.dispatch({
      effects: EditorView.scrollIntoView(view.state.doc.toString().indexOf(phrase), {
        y: 'center',
      }),
    });
  }, phrase);
  await expect(page.locator('.cm-line').filter({ hasText: phrase }).first()).toBeInViewport();
}

async function clickDisplayedText(page: Page, phrase: string, offset = 9) {
  const target = await page.evaluate(
    async ({ phrase, offset }) => {
      const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
      const view = viewForElement(document.querySelector('.cm-content') as HTMLElement)!;
      const line = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')).find(
        (element) => element.textContent?.includes(phrase)
      );
      if (!line) throw new Error(`Missing displayed text: ${phrase}`);
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let remaining = line.textContent!.indexOf(phrase) + offset;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const length = node.textContent?.length ?? 0;
        if (remaining < length) {
          const range = document.createRange();
          range.setStart(node, remaining);
          range.setEnd(node, remaining + 1);
          const rect = range.getBoundingClientRect();
          return {
            x: rect.left + rect.width * 0.2,
            y: rect.top + rect.height / 2,
            expected: view.state.doc.toString().indexOf(phrase) + offset,
          };
        }
        remaining -= length;
      }
      throw new Error(`Missing offset in ${phrase}`);
    },
    { phrase, offset }
  );
  await page.mouse.click(target.x, target.y);
  const actual = await page.evaluate(async () => {
    const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
    const view = viewForElement(document.querySelector('.cm-content') as HTMLElement)!;
    return {
      head: view.state.selection.main.head,
      line: view.state.doc.lineAt(view.state.selection.main.head).text,
    };
  });
  expect(
    actual.head,
    `${phrase}: clicked ${JSON.stringify(target)}, selected ${JSON.stringify(actual)}`
  ).toBe(target.expected);
  return target.expected;
}

test('prose clicks remain on the displayed line after repeated code expansion and scrolling', async ({
  page,
}) => {
  await installWorkspaceMock(page, 'dark', false, false, content, {
    fontScale: 1.3,
    fontMono: 'Consolas',
  });
  await page.setViewportSize({ width: 900, height: 650 });
  await page.goto('/e2e/workspace.html');
  await expect(page.locator('.cm-content')).toContainText('Layout section 0');
  for (const block of [0, 2, 8, 18, 30, 48, 59, 8, 0]) {
    const code = `const layout_${block}_row_2 = 2;`;
    await scrollToText(page, code);
    for (let round = 0; round < 3; round++) {
      await clickDisplayedText(page, code);
      await clickDisplayedText(page, `Paragraph after code ${block}.`);
      await clickDisplayedText(page, `Paragraph before code ${block}.`);
    }
  }
});

for (const clickCount of [1, 2, 3])
  test(`click count ${clickCount} uses displayed text during a pending block measurement`, async ({
    page,
  }) => {
    await page.goto('/e2e/editor-interaction.html');
    await page.evaluate(async () => {
      const { EditorState, StateField } =
        await import('/node_modules/.vite/deps/@codemirror_state.js');
      const { EditorView, WidgetType, Decoration } =
        await import('/node_modules/.vite/deps/@codemirror_view.js');
      const { baseEditorExtensions, getExtensionsForMode } =
        await import('/src/lib/cm-extensions/markdown-mode.ts');
      const host = document.createElement('div');
      host.className = 'editor-workspace';
      host.style.cssText =
        'position:fixed;inset:16px auto auto 16px;width:700px;height:500px;overflow:hidden';
      document.body.appendChild(host);
      const doc = [
        ...Array.from({ length: 60 }, (_, i) => `Before resizable block ${i}.\n`),
        'RESIZABLE BLOCK',
        '',
        ...Array.from({ length: 120 }, (_, i) => `After resizable block ${i}.\n`),
      ].join('\n');
      class ResizableBlock extends WidgetType {
        get estimatedHeight() {
          return 20;
        }
        toDOM() {
          const element = document.createElement('div');
          element.dataset.resizableTestBlock = 'true';
          element.style.height = '20px';
          return element;
        }
      }
      const from = doc.indexOf('RESIZABLE BLOCK');
      const blocks = StateField.define({
        create: () =>
          Decoration.set([
            Decoration.replace({ block: true, widget: new ResizableBlock() }).range(
              from,
              from + 15
            ),
          ]),
        update: (value) => value,
        provide: (field) => EditorView.decorations.from(field),
      });
      const view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc,
          extensions: [baseEditorExtensions, getExtensionsForMode('edit-render'), blocks],
        }),
      });
      Object.assign(window, { __resizableBlockView: view });
      view.dispatch({
        effects: EditorView.scrollIntoView(doc.indexOf('After resizable block 8.'), {
          y: 'center',
        }),
      });
    });
    await expect(
      page.locator('.cm-line').filter({ hasText: 'After resizable block 8.' })
    ).toBeInViewport();
    const result = await page.evaluate((clickCount) => {
      const view = (window as any).__resizableBlockView;
      const widget = document.querySelector<HTMLElement>('[data-resizable-test-block]')!;
      widget.style.height = '140px';
      view.requestMeasure();
      // A pointer event can arrive before the next animation-frame measurement.
      const line = Array.from(document.querySelectorAll<HTMLElement>('.cm-line')).find(
        (line) => line.textContent === 'After resizable block 8.'
      )!;
      const range = document.createRange();
      range.setStart(line.firstChild!, 8);
      range.setEnd(line.firstChild!, 9);
      const rect = range.getBoundingClientRect();
      const init = {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width * 0.2,
        clientY: rect.top + rect.height / 2,
        button: 0,
        detail: clickCount,
      };
      line.dispatchEvent(new MouseEvent('mousedown', { ...init, buttons: 1 }));
      line.ownerDocument.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
      const from = view.state.doc.toString().indexOf('After resizable block 8.');
      return {
        actual: view.state.selection.main.toJSON(),
        expected:
          clickCount === 1
            ? { anchor: from + 8, head: from + 8 }
            : clickCount === 2
              ? { anchor: from + 6, head: from + 15 }
              : { anchor: from, head: from + 'After resizable block 8.\n'.length },
      };
    }, clickCount);
    expect(result.actual).toEqual(result.expected);

    // A future widget should not need to know about CodeMirror's height map.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('[data-resizable-test-block]')!.style.height = '60px';
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const view = (window as any).__resizableBlockView;
          return view.lineBlockAt(view.state.doc.toString().indexOf('RESIZABLE BLOCK')).height;
        })
      )
      .toBe(60);
    await clickDisplayedText(page, 'After resizable block 8.', 8);
  });

test('prose stays editable at the clicked position after chart and table expansion', async ({
  page,
}) => {
  const mixed = [
    '# Mixed layout',
    '',
    '```typescript',
    'const mixed_code = true;',
    'console.log(mixed_code);',
    '```',
    '',
    'After code target.',
    '',
    '```chart',
    'type: bar',
    'data:',
    '  labels: [A, B]',
    '  datasets:',
    '    - data: [1, 2]',
    '```',
    '',
    'After chart target.',
    '',
    '| Name | Value |',
    '| --- | --- |',
    '| First row | **Editable value** |',
    '| Second row | Another value |',
    '',
    'After table target.',
    '',
    ...Array.from({ length: 50 }, (_, line) => `Tail paragraph ${line}.\n`),
  ].join('\n');
  await installWorkspaceMock(page, 'dark', false, false, mixed, { fontScale: 1.3 });
  await page.setViewportSize({ width: 900, height: 650 });
  await page.goto('/e2e/workspace.html');
  await expect(page.locator('.cm-content')).toContainText('Mixed layout');
  for (let round = 0; round < 3; round++) {
    await scrollToText(page, 'const mixed_code = true;');
    await clickDisplayedText(page, 'const mixed_code = true;');
    await clickDisplayedText(page, 'After code target.');

    await scrollToText(page, 'After chart target.');
    await page.locator('.cm-chart-widget-container').hover();
    await page.getByRole('button', { name: 'Chart actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit chart', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.locator('.cm-chart-textarea')).toBeHidden();
    await scrollToText(page, 'After chart target.');
    await clickDisplayedText(page, 'After chart target.');

    await scrollToText(page, 'After table target.');
    const cell = page.locator('.cm-table-widget [data-row-index="0"][data-column-index="1"]');
    await cell.click();
    await expect(cell).toBeFocused();
    await expect(cell).toHaveAttribute('contenteditable', 'true');
    await page.locator('[data-row-controls="0"] .btn-table-control').first().click();
    await scrollToText(page, 'After table target.');
    const position = await clickDisplayedText(page, 'After table target.');
    const before = await page.evaluate(async () => {
      const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
      return viewForElement(
        document.querySelector('.cm-content') as HTMLElement
      )!.state.doc.toString();
    });
    await page.keyboard.type('!');
    const after = await page.evaluate(async () => {
      const { viewForElement } = await import('/src/visual-fixtures/writeCursorFixture.ts');
      return viewForElement(
        document.querySelector('.cm-content') as HTMLElement
      )!.state.doc.toString();
    });
    expect(after).toBe(before.slice(0, position) + '!' + before.slice(position));
    await page.keyboard.press('Control+z');
  }
});
