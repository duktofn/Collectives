import { expect, test, type Page } from "@playwright/test";

async function mountEditor(page: Page, mode: "edit-render" | "view" = "edit-render") {
  await page.evaluate(async (editorMode) => {
    const host = document.createElement("div");
    host.id = "code-block-interaction-host";
    host.style.cssText = "position: fixed; z-index: 9999; top: 16px; left: 16px; width: 760px; height: 520px; overflow: hidden; background: var(--bg-primary);";
    document.body.appendChild(host);
    const fixture = await import("/src/visual-fixtures/editorCodeBlockFixture.ts");
    fixture.mountCodeBlockInteractionFixture(host, editorMode);
  }, mode);
  await expect(page.locator("#code-block-interaction-host .cm-editor")).toBeVisible();
}

async function clipboardText(page: Page) {
  // The Windows clipboard represents line breaks as CRLF.
  return page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'));
}

for (const mode of ['edit-render', 'view'] as const) {
  test(`language label copies its code in ${mode} without changing the document or selection`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/e2e/editor-interaction.html');
    await mountEditor(page, mode);
    const before = await page.evaluate(() => {
      const view = (window as any).__codeBlockInteractionView;
      return { doc: view.state.doc.toString(), selection: view.state.selection.toJSON() };
    });
    const copy = page.getByRole('button', { name: 'Copy TypeScript code to clipboard' });
    await copy.click();
    const expected = [
      'const greeting = "Xin chào 🌱";',
      '\tconsole.log(greeting);',
      'const longLine = "0123456789abcdefghijklmnopqrstuvwxyz".repeat(8);',
    ].join('\n');
    await expect.poll(() => clipboardText(page)).toBe(expected);
    await expect(copy).toHaveText('Copied!');
    await expect(page.locator('.cm-codeblock-fence-edit')).toHaveCount(0);
    const after = await page.evaluate(() => {
      const view = (window as any).__codeBlockInteractionView;
      return { doc: view.state.doc.toString(), selection: view.state.selection.toJSON() };
    });
    expect(after).toEqual(before);
  });
}

test('copy uses the current body after earlier edits and supports Enter and Space', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/e2e/editor-interaction.html');
  await mountEditor(page);
  await page.evaluate(() => {
    const view = (window as any).__codeBlockInteractionView;
    const doc = ['Before', '', '```text', 'first', '```', '', '```text', '\tsecond 🌱', '', '```'].join('\n');
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc }, selection: { anchor: 0 } });
  });
  const copies = page.getByRole('button', { name: 'Copy Text code to clipboard' });
  await expect(copies).toHaveCount(2);
  await page.evaluate(() => {
    const view = (window as any).__codeBlockInteractionView;
    const from = view.state.doc.toString().indexOf('second');
    view.dispatch({ changes: [{ from: 0, insert: 'Added before both blocks.\n\n' },
      { from, to: from + 'second'.length, insert: 'updated' }], selection: { anchor: 0 } });
  });
  await copies.nth(1).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => clipboardText(page)).toBe('\tupdated 🌱\n');
  await copies.nth(0).focus();
  await page.keyboard.press('Space');
  await expect.poll(() => clipboardText(page)).toBe('first');
  await expect(page.locator('.cm-codeblock-fence-edit')).toHaveCount(0);
});

for (const { source, expected } of [
  { source: ['Before', '', '```text', '```'].join('\n'), expected: '' },
  { source: ['Before', '', '~~~text', '  unclosed 🌱', '', ''].join('\n'), expected: '  unclosed 🌱\n\n' },
  { source: ['Before', '', '````text', '```', '\tvalue', '````'].join('\n'), expected: '```\n\tvalue' },
]) {
  test(`copy preserves code from empty, unterminated, and longer-fenced blocks: ${JSON.stringify(expected)}`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/e2e/editor-interaction.html');
    await mountEditor(page, 'view');
    await page.evaluate((source) => {
      const view = (window as any).__codeBlockInteractionView;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
    }, source);
    await page.getByRole('button', { name: 'Copy Text code to clipboard' }).click();
    await expect.poll(() => clipboardText(page)).toBe(expected);
  });
}

test('clipboard failure shows feedback and permits retry, then restores the language label', async ({ page }) => {
  await page.goto('/e2e/editor-interaction.html');
  await mountEditor(page, 'view');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async () => { throw new Error('Clipboard unavailable'); },
    } });
  });
  const copy = page.getByRole('button', { name: 'Copy Text code to clipboard' });
  await copy.click();
  await expect(copy).toHaveText('Copy failed');
  await expect(copy).toBeEnabled();
  await page.evaluate(() => {
    (navigator.clipboard as any).writeText = async (text: string) => { (window as any).__copiedCode = text; };
  });
  await copy.click();
  await expect(copy).toHaveText('Copied!');
  expect(await page.evaluate(() => (window as any).__copiedCode)).toBe('last line in the second block');
  await expect(copy).toHaveText('Text');
});

async function pointAtText(page: Page, exactLine: string, offset: number) {
  return page.evaluate(({ exactLine: lineText, offset: charOffset }) => {
    const line = Array.from(document.querySelectorAll<HTMLElement>("#code-block-interaction-host .cm-line"))
      .find((candidate) => candidate.textContent === lineText);
    if (!line) throw new Error(`Could not find code line: ${lineText}`);
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let remaining = charOffset;
    let textNode: Text | null = null;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node as Text;
      if (remaining <= text.length) { textNode = text; break; }
      remaining -= text.length;
    }
    if (!textNode) throw new Error(`Could not map offset ${charOffset} in ${lineText}`);
    const range = document.createRange();
    range.setStart(textNode, remaining);
    range.setEnd(textNode, Math.min(textNode.length, remaining + 1));
    const rect = range.getBoundingClientRect();
    return { x: rect.left + 0.1, y: rect.top + rect.height / 2 };
  }, { exactLine, offset });
}

for (const mode of ["edit-render", "view"] as const) {
  test(`long code stays inside its background in ${mode} mode`, async ({ page }) => {
    await page.goto("/e2e/editor-interaction.html", { waitUntil: "commit" });
    await mountEditor(page, mode);
    const code = [
      "private void OnEnable()",
      "{",
      "    Session.Combat.ProjectilesEnabled = Session.Phase == PlayPhase.Combat || Session.Combat.Projectiles.Count > 0;",
      `    var identifier = "${"abcdefghijklmnopqrstuvwxyz".repeat(12)}";`,
      "}",
    ];
    const source = ["```csharp", ...code, "```"].join("\n");
    await page.evaluate(({ source, mode }) => {
      const host = document.querySelector<HTMLElement>("#code-block-interaction-host")!;
      host.classList.add("editor-workspace");
      const view = (window as any).__codeBlockInteractionView;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: source },
        selection: { anchor: mode === "edit-render" ? source.indexOf("Session") : 0 },
      });
    }, { source, mode });

    for (const width of [760, 360]) {
      await page.locator("#code-block-interaction-host").evaluate((host, width) => {
        host.style.width = `${width}px`;
      }, width);
      await expect(async () => {
        const geometry = await page.locator(".cm-codeblock-line").evaluateAll((lines) =>
          lines.filter((line) => line.textContent!.length > 100).map((line) => {
            const bounds = line.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(line);
            return {
              wrapped: bounds.height > parseFloat(getComputedStyle(line).lineHeight) * 1.5,
              contained: Array.from(range.getClientRects()).every((rect) =>
                rect.left >= bounds.left && rect.right <= bounds.right + 1),
            };
          })
        );
        expect(geometry).toHaveLength(2);
        expect(geometry.every((line) => line.wrapped && line.contained)).toBe(true);
      }).toPass({ timeout: 5000 });
    }

    if (mode === "edit-render") {
      const offset = code[2].indexOf("Projectiles.Count");
      const point = await pointAtText(page, code[2], offset);
      await page.mouse.click(point.x, point.y);
      const head = await page.evaluate(() =>
        (window as any).__codeBlockInteractionView.state.selection.main.head);
      expect(head).toBe(source.indexOf(code[2]) + offset);
    }
    expect(await page.evaluate(() =>
      (window as any).__codeBlockInteractionView.state.doc.toString())).toBe(source);
    await page.locator("#code-block-interaction-host").screenshot({
      path: `artifacts/ux-islands/long-code-${mode}.png`,
    });
  });
}

test("click, vertical movement, and drag use CodeMirror source geometry", async ({ page }) => {
  await page.goto("/e2e/editor-interaction.html", { waitUntil: "commit" });
  await mountEditor(page);
  const lineText = "\tconsole.log(greeting);";
  const clickOffset = lineText.indexOf("log");
  const point = await pointAtText(page, lineText, clickOffset);
  await page.mouse.click(point.x, point.y);

  const clicked = await page.evaluate(() => {
    const view = (window as unknown as { __codeBlockInteractionView: import("@codemirror/view").EditorView }).__codeBlockInteractionView;
    return {
      head: view.state.selection.main.head,
      expected: view.state.doc.toString().indexOf("\tconsole.log(greeting);") + "\tconsole.".length,
      line: view.state.doc.lineAt(view.state.selection.main.head).number,
      hasCodeWidget: Boolean(view.dom.querySelector(".cm-codeblock-widget-container")),
    };
  });
  expect(clicked.head).toBe(clicked.expected);
  expect(clicked.line).toBe(5);
  expect(clicked.hasCodeWidget).toBe(false);
  await expect(page.locator('#code-block-interaction-host .cm-codeblock-fence-edit')).toHaveText(['```typescript', '```']);
  await page.screenshot({ path: 'artifacts/ux-islands/write-code-fences.png' });

  await page.keyboard.press("ArrowDown");
  const normalLine = await page.evaluate(() => {
    const view = (window as unknown as { __codeBlockInteractionView: import("@codemirror/view").EditorView }).__codeBlockInteractionView;
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  });
  expect(normalLine).toBe(6);
  await page.keyboard.press("Shift+ArrowDown");
  const moved = await page.evaluate(() => {
    const view = (window as unknown as { __codeBlockInteractionView: import("@codemirror/view").EditorView }).__codeBlockInteractionView;
    return {
      line: view.state.doc.lineAt(view.state.selection.main.head).number,
      selected: view.state.selection.main.from !== view.state.selection.main.to,
      docChanged: view.state.doc.toString().includes("console.log(greeting);") && view.state.doc.toString().includes("last line in the second block"),
    };
  });
  expect(moved.line).toBeGreaterThanOrEqual(6);
  expect(moved.selected).toBe(true);
  expect(moved.docChanged).toBe(true);

  const start = await pointAtText(page, "const greeting = \"Xin chào 🌱\";", 6);
  const end = await pointAtText(page, lineText, lineText.length - 1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  const dragged = await page.evaluate(() => {
    const view = (window as unknown as { __codeBlockInteractionView: import("@codemirror/view").EditorView }).__codeBlockInteractionView;
    return view.state.doc.sliceString(view.state.selection.main.from, view.state.selection.main.to);
  });
  expect(dragged).toContain("console.log");
  expect(dragged).toContain("Xin chào");
  expect(dragged).not.toContain("```");
});

test("Write lets the user edit the visible code fence language", async ({ page }) => {
  await page.goto("/e2e/editor-interaction.html", { waitUntil: "commit" });
  await mountEditor(page);
  const body = await pointAtText(page, "const greeting = \"Xin chào 🌱\";", 6);
  await page.mouse.click(body.x, body.y);
  await page.locator('#code-block-interaction-host .cm-codeblock-fence-edit').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Control+Shift+ArrowLeft');
  await page.keyboard.type('javascript');
  await expect(page.locator('#code-block-interaction-host .cm-codeblock-fence-edit').first()).toHaveText('```javascript');
  const source = await page.evaluate(() => (window as any).__codeBlockInteractionView.state.doc.toString());
  expect(source).toContain('```javascript\nconst greeting');
});

test("read-only mode exposes code text for selection without making it editable", async ({ page }) => {
  await page.goto("/e2e/editor-interaction.html", { waitUntil: "commit" });
  await mountEditor(page, "view");
  const editor = page.locator("#code-block-interaction-host .cm-content");
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(page.locator("#code-block-interaction-host .cm-codeblock-widget-container")).toHaveCount(0);
  await expect(page.locator("#code-block-interaction-host .cm-codeblock-line:not(.cm-codeblock-fence-line)")).toHaveCount(4);
});

test("Shift+ArrowDown extends one CodeMirror selection through adjacent blocks and prose", async ({ page }) => {
  await page.goto("/e2e/editor-interaction.html", { waitUntil: "commit" });
  await mountEditor(page);
  const start = await pointAtText(page, "const greeting = \"Xin chào 🌱\";", 0);
  await page.mouse.click(start.x, start.y);
  const before = await page.evaluate(() => {
    const view = (window as unknown as { __codeBlockInteractionView: import("@codemirror/view").EditorView }).__codeBlockInteractionView;
    return view.state.selection.main.head;
  });

  // The active block includes editable opening and closing fence rows.
  for (let step = 0; step < 14; step++) await page.keyboard.press("Shift+ArrowDown");

  const selected = await page.evaluate((anchor) => {
    const view = (window as unknown as { __codeBlockInteractionView: import("@codemirror/view").EditorView }).__codeBlockInteractionView;
    const range = view.state.selection.main;
    return {
      anchor: range.anchor,
      text: view.state.doc.sliceString(range.from, range.to),
      start: anchor,
      editorConnected: view.dom.isConnected,
    };
  }, before);
  expect(selected.anchor).toBe(selected.start);
  expect(selected.text).toContain("const greeting");
  expect(selected.text).toContain("last line in the second block");
  expect(selected.text).toContain("After both code blocks.");
  expect(selected.editorConnected).toBe(true);
});

test("drag selection crosses code blocks and prose without replacing the editor DOM", async ({ page }) => {
  await page.goto("/e2e/editor-interaction.html", { waitUntil: "commit" });
  await mountEditor(page);
  const start = await pointAtText(page, "const greeting = \"Xin chào 🌱\";", 6);
  const end = await pointAtText(page, "After both code blocks.", 5);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();

  const dragged = await page.evaluate(() => {
    const view = (window as unknown as { __codeBlockInteractionView: import("@codemirror/view").EditorView }).__codeBlockInteractionView;
    const range = view.state.selection.main;
    return {
      text: view.state.doc.sliceString(range.from, range.to),
      editorConnected: view.dom.isConnected,
      hasCodeWidget: Boolean(view.dom.querySelector(".cm-codeblock-widget-container")),
    };
  });
  expect(dragged.text).toContain("greeting =");
  expect(dragged.text).toContain("last line in the second block");
  expect(dragged.text).toContain("After");
  expect(dragged.editorConnected).toBe(true);
  expect(dragged.hasCodeWidget).toBe(false);
});

test("Markdown delimiter input creates a bold pair and overtypes both closing stars", async ({ page }) => {
  await page.goto("/e2e/editor-interaction.html", { waitUntil: "commit" });
  await mountEditor(page);
  await page.evaluate(() => {
    const view = (window as unknown as { __codeBlockInteractionView: import("@codemirror/view").EditorView }).__codeBlockInteractionView;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.focus();
  });

  await page.keyboard.type("**bold**");
  const doc = await page.evaluate(() => {
    const view = (window as unknown as { __codeBlockInteractionView: import("@codemirror/view").EditorView }).__codeBlockInteractionView;
    return view.state.doc.toString();
  });
  expect(doc.endsWith("**bold**")).toBe(true);
});
