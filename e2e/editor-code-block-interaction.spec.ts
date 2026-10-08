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
