import { expect, test, type Page } from "@playwright/test";

async function mountEditor(page: Page, fixture: "history" | "table") {
  await page.evaluate(async (kind) => {
    const host = document.createElement("div");
    host.id = "regression-host";
    host.className = "editor-workspace";
    host.style.cssText = "position: fixed; z-index: 9999; inset: 16px auto auto 16px; width: 720px; height: 640px; overflow: hidden; background: var(--bg-primary);";
    document.body.appendChild(host);
    if (kind === "table") {
      const module = await import("/src/visual-fixtures/editorTableFixture.ts");
      module.mountTableInteractionFixture(host);
    } else {
      const module = await import("/src/visual-fixtures/editorHistoryFixture.ts");
      module.mountHistoryFixture(host);
    }
  }, fixture);
  await expect(page.locator("#regression-host .cm-editor")).toBeVisible();
}

async function pointAtText(page: Page, lineText: string, offset: number) {
  return page.evaluate(({ targetText, targetOffset }) => {
    const line = Array.from(document.querySelectorAll<HTMLElement>("#regression-host .cm-line"))
      .find((candidate) => candidate.textContent === targetText);
    if (!line) throw new Error(`Missing line ${targetText}`);
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let remaining = targetOffset;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node as Text;
      if (remaining <= text.length) {
        const range = document.createRange();
        range.setStart(text, remaining);
        range.setEnd(text, Math.min(text.length, remaining + 1));
        const rect = range.getBoundingClientRect();
        return { x: rect.left + 0.1, y: rect.top + rect.height / 2 };
      }
      remaining -= text.length;
    }
    throw new Error(`Could not locate offset ${targetOffset}`);
  }, { targetText: lineText, targetOffset: offset });
}

test("renders code selection above line backgrounds and keeps table controls outside cells", async ({ page }) => {
  await page.goto("/e2e/editor-interaction.html", { waitUntil: "commit" });
  await mountEditor(page, "history");
  const start = await pointAtText(page, "const selected = true;", 6);
  const end = await pointAtText(page, "const selected = true;", 14);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  const selectionMetrics = await page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>("#regression-host .cm-selectionLayer");
    const selection = document.querySelector<HTMLElement>("#regression-host .cm-selectionBackground");
    const line = document.querySelector<HTMLElement>("#regression-host .cm-codeblock-line:not(.cm-codeblock-fence-line)");
    const view = (window as unknown as { __historyFixture: { view: import("@codemirror/view").EditorView } }).__historyFixture.view;
    return {
      layerStyle: layer ? { zIndex: getComputedStyle(layer).zIndex, position: getComputedStyle(layer).position } : null,
      selectionStyle: selection ? { background: getComputedStyle(selection).backgroundColor, rect: selection.getBoundingClientRect().toJSON() } : null,
      lineStyle: line ? { background: getComputedStyle(line).backgroundColor, zIndex: getComputedStyle(line).zIndex } : null,
      nativeSelection: window.getSelection()?.toString() ?? "",
      selectedDocumentText: view.state.doc.sliceString(view.state.selection.main.from, view.state.selection.main.to),
    };
  });
  await page.screenshot({ path: "test-results/render-selection-after.png" });
  expect(selectionMetrics.layerStyle?.zIndex).toBe("1");
  expect(selectionMetrics.selectionStyle?.background).not.toBe(selectionMetrics.lineStyle?.background);
  expect(selectionMetrics.nativeSelection).toBe("selected");
  expect(selectionMetrics.selectedDocumentText).toBe("selected");
  await page.evaluate(() => {
    const view = (window as unknown as { __historyFixture: { view: import("@codemirror/view").EditorView } }).__historyFixture.view;
    view.contentDOM.blur();
  });
  const unfocusedSelection = await page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>("#regression-host .cm-selectionLayer");
    const selection = document.querySelector<HTMLElement>("#regression-host .cm-selectionBackground");
    return {
      focused: document.querySelector("#regression-host .cm-editor")?.classList.contains("cm-focused"),
      layerIndex: layer ? getComputedStyle(layer).zIndex : null,
      background: selection ? getComputedStyle(selection).backgroundColor : null,
    };
  });
  expect(unfocusedSelection.focused).toBe(false);
  expect(unfocusedSelection.layerIndex).toBe("1");
  expect(unfocusedSelection.background).toBe(selectionMetrics.selectionStyle?.background);
  await page.screenshot({ path: "test-results/render-selection-unfocused.png" });

  await page.locator("#regression-host .cm-content").click();
  const proseStart = await pointAtText(page, "Edit this prose line.", 7);
  const codeEnd = await pointAtText(page, "const selected = true;", 17);
  await page.mouse.move(proseStart.x, proseStart.y);
  await page.mouse.down();
  await page.mouse.move(codeEnd.x, codeEnd.y, { steps: 6 });
  await page.mouse.up();
  const crossBlockText = await page.evaluate(() => {
    const view = (window as unknown as { __historyFixture: { view: import("@codemirror/view").EditorView } }).__historyFixture.view;
    return view.state.doc.sliceString(view.state.selection.main.from, view.state.selection.main.to);
  });
  expect(crossBlockText).toContain("prose line");
  expect(crossBlockText).toContain("const selected");
  await page.screenshot({ path: "test-results/render-selection-cross-block.png" });

  await page.goto("/e2e/editor-interaction.html", { waitUntil: "commit" });
  await mountEditor(page, "table");
  const tableMetrics = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>("#regression-host")!;
    const shell = host.querySelector<HTMLElement>(".cm-table-widget-container")!;
    const scroll = host.querySelector<HTMLElement>(".cm-table-scroll")!;
    const cell = host.querySelector<HTMLElement>('[data-row-index="0"][data-column-index="0"]')!;
    cell.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, clientX: 30, clientY: 120 }));
    const group = host.querySelector<HTMLElement>('[data-column-controls="0"][data-edge="top"]')!;
    const bottom = host.querySelector<HTMLElement>('[data-column-controls="0"][data-edge="bottom"]')!;
    const rowControls = host.querySelector<HTMLElement>('[data-row-controls="0"]')!;
    const code = host.querySelector<HTMLElement>(".cm-table-widget code")!;
    const shellRect = shell.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const buttonRect = group.getBoundingClientRect();
    const intersects = (left: DOMRect, right: DOMRect) => left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
    const allCells = Array.from(host.querySelectorAll<HTMLElement>("[data-row-index][data-column-index]"));
    const activeControlRects = [group, bottom, rowControls].map((control) => control.getBoundingClientRect());
    return {
      scroll: scrollRect.toJSON(), cell: cellRect.toJSON(), topControl: buttonRect.toJSON(),
      cellIntersections: activeControlRects.map((controlRect) => allCells.filter((candidate) => intersects(candidate.getBoundingClientRect(), controlRect)).map((candidate) => candidate.getAttribute("aria-label"))),
      shellPadding: getComputedStyle(shell).padding,
      codeStyle: { classes: code.className, fontFamily: getComputedStyle(code).fontFamily, color: getComputedStyle(code).color, background: getComputedStyle(code).backgroundColor, padding: getComputedStyle(code).padding, borderRadius: getComputedStyle(code).borderRadius },
      shellRect: shellRect.toJSON(),
    };
  });
  await page.screenshot({ path: "test-results/table-control-layout-after.png" });
  expect(tableMetrics.cellIntersections.flat()).toEqual([]);
  expect(tableMetrics.shellRect.width).toBeLessThanOrEqual(720);
  expect(Math.abs(tableMetrics.scroll.left - tableMetrics.shellRect.left)).toBeLessThan(2);
  expect(tableMetrics.codeStyle.fontFamily).toContain("monospace");
  expect(tableMetrics.codeStyle.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(tableMetrics.codeStyle.padding).not.toBe("0px");
});

test("checks active table edit history and render-mode history baseline", async ({ page }) => {
  await page.goto("/e2e/editor-interaction.html", { waitUntil: "commit" });
  await mountEditor(page, "table");
  const cell = page.locator('#regression-host [data-row-index="1"][data-column-index="1"]');
  await cell.click();
  await cell.pressSequentially("+");
  const beforeUndo = await page.evaluate(() => {
    const view = (window as unknown as { __tableInteractionView: import("@codemirror/view").EditorView }).__tableInteractionView;
    const cell = document.querySelector<HTMLElement>('#regression-host [data-row-index="1"][data-column-index="1"]');
    return { document: view.state.doc.toString(), dom: cell?.textContent, editing: cell?.dataset.editing, active: document.activeElement === cell, cursor: view.state.selection.main.head };
  });
  await cell.press("Control+z");
  const afterUndo = await page.evaluate(() => {
    const view = (window as unknown as { __tableInteractionView: import("@codemirror/view").EditorView }).__tableInteractionView;
    const cell = document.querySelector<HTMLElement>('#regression-host [data-row-index="1"][data-column-index="1"]');
    return { document: view.state.doc.toString(), dom: cell?.textContent, editing: cell?.dataset.editing, active: document.activeElement === cell, cursor: view.state.selection.main.head };
  });
  expect(beforeUndo.document).toContain("pl+ain");
  expect(beforeUndo.dom).toBe("pl+ain");
  expect(afterUndo.document).toContain("| Escaped " + "\\" + "| pipe | plain |");
  expect(afterUndo.dom).toBe("plain");
  expect(afterUndo.editing).toBe("true");
  await cell.press("Control+Shift+z");
  await expect.poll(() => page.evaluate(() => {
    const view = (window as unknown as { __tableInteractionView: import("@codemirror/view").EditorView }).__tableInteractionView;
    return view.state.doc.toString();
  })).toContain("pl+ain");
  await cell.pressSequentially("discard");
  await cell.press("Escape");
  await expect.poll(() => page.evaluate(() => {
    const view = (window as unknown as { __tableInteractionView: import("@codemirror/view").EditorView }).__tableInteractionView;
    return view.state.doc.toString();
  })).toContain("pl+ain");
  await cell.press("Control+y");
  await expect.poll(() => page.evaluate(() => {
    const view = (window as unknown as { __tableInteractionView: import("@codemirror/view").EditorView }).__tableInteractionView;
    return view.state.doc.toString();
  })).not.toContain("discard");

  await page.locator('#regression-host [data-row-index="0"][data-column-index="0"]').hover();
  await page.getByRole("button", { name: "+ Add row below row 1" }).click();
  await expect(page.locator("#regression-host .cm-table-widget tbody tr")).toHaveCount(3);
  const updatedCell = page.locator('#regression-host [data-row-index="1"][data-column-index="1"]');
  await updatedCell.press("Control+z");
  await expect(page.locator("#regression-host .cm-table-widget tbody tr")).toHaveCount(2);
  await updatedCell.press("Control+Shift+z");
  await expect(page.locator("#regression-host .cm-table-widget tbody tr")).toHaveCount(3);

  await page.goto("/e2e/editor-interaction.html", { waitUntil: "commit" });
  await mountEditor(page, "history");
  await page.evaluate(() => {
    const fixture = (window as unknown as { __historyFixture: { view: import("@codemirror/view").EditorView; setMode: (mode: "view" | "edit-source" | "edit-render") => void } }).__historyFixture;
    const view = fixture.view;
    const end = view.state.doc.length;
    view.dispatch({ changes: { from: end, insert: " changed" }, selection: { anchor: end + 8 } });
    fixture.setMode("edit-source");
    return { afterModeSwitch: view.state.doc.toString() };
  });
  await page.locator("#regression-host .cm-content").press("Control+z");
  const modeUndo = await page.evaluate(() => {
    const fixture = (window as unknown as { __historyFixture: { view: import("@codemirror/view").EditorView } }).__historyFixture;
    return fixture.view.state.doc.toString();
  });
  expect(modeUndo).not.toContain("changed");

  const fileIsolation = await page.evaluate(async () => {
    const fixture = (window as unknown as {
      __historyFixture: { view: import("@codemirror/view").EditorView; openDocument: (doc: string) => void };
    }).__historyFixture;
    const view = fixture.view;
    const end = view.state.doc.length;
    view.dispatch({ changes: { from: end, insert: " old edit" }, selection: { anchor: end + 9 } });
    fixture.openDocument("different file contents");
    return view.state.doc.toString();
  });
  await page.locator("#regression-host .cm-content").press("Control+z");
  const afterFileUndo = await page.evaluate(() => {
    const fixture = (window as unknown as { __historyFixture: { view: import("@codemirror/view").EditorView } }).__historyFixture;
    return fixture.view.state.doc.toString();
  });
  expect(fileIsolation).toBe("different file contents");
  expect(afterFileUndo).toBe("different file contents");
});

test("keeps controls in gutters while horizontally scrolling and exposes them to keyboard", async ({ page }) => {
  await page.goto("/e2e/editor-interaction.html", { waitUntil: "commit" });
  await mountEditor(page, "table");
  const host = page.locator("#regression-host");
  await page.locator("#regression-host").evaluate((element) => { element.style.width = "420px"; });
  const scroll = host.locator(".cm-table-scroll");
  await scroll.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect.poll(() => scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  const lastCell = host.locator('[data-row-index="1"][data-column-index="2"]');
  await lastCell.hover();
  const top = host.locator('[data-column-controls="2"][data-edge="top"]');
  const bottom = host.locator('[data-column-controls="2"][data-edge="bottom"]');
  await expect(top).toBeVisible();
  await expect(bottom).toBeVisible();

  const visibleGeometry = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>("#regression-host .cm-table-widget-container")!;
    const scroll = document.querySelector<HTMLElement>("#regression-host .cm-table-scroll")!;
    const cell = document.querySelector<HTMLElement>('#regression-host [data-row-index="1"][data-column-index="2"]')!;
    const controls = [
      document.querySelector<HTMLElement>('#regression-host [data-column-controls="2"][data-edge="top"]')!,
      document.querySelector<HTMLElement>('#regression-host [data-column-controls="2"][data-edge="bottom"]')!,
      document.querySelector<HTMLElement>('#regression-host [data-row-controls="1"]')!,
    ];
    const intersects = (left: DOMRect, right: DOMRect) => left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
    const cells = Array.from(document.querySelectorAll<HTMLElement>("#regression-host [data-row-index][data-column-index]"));
    const shellRect = shell.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const visibleCellRect = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      const left = Math.max(rect.left, scrollRect.left + scroll.clientLeft);
      const right = Math.min(rect.right, scrollRect.left + scroll.clientLeft + scroll.clientWidth);
      const top = Math.max(rect.top, scrollRect.top + scroll.clientTop);
      const bottom = Math.min(rect.bottom, scrollRect.top + scroll.clientTop + scroll.clientHeight);
      return right <= left || bottom <= top ? null : new DOMRect(left, top, right - left, bottom - top);
    };
    return {
      shell: shellRect.toJSON(), scroll: scrollRect.toJSON(), cell: cellRect.toJSON(),
      controlRects: controls.map((control) => control.getBoundingClientRect().toJSON()),
      overlaps: controls.map((control) => cells.filter((candidate) => {
        const visible = visibleCellRect(candidate);
        return visible !== null && intersects(visible, control.getBoundingClientRect());
      }).length),
    };
  });
  expect(visibleGeometry.shell.width).toBeLessThanOrEqual(420);
  expect(visibleGeometry.scroll.left).toBeGreaterThanOrEqual(visibleGeometry.shell.left + 63);
  expect(visibleGeometry.controlRects[0].bottom).toBeLessThanOrEqual(visibleGeometry.scroll.top);
  expect(visibleGeometry.controlRects[1].top).toBeGreaterThanOrEqual(visibleGeometry.scroll.bottom);
  expect(visibleGeometry.controlRects[2].right).toBeLessThanOrEqual(visibleGeometry.scroll.left);
  expect(visibleGeometry.overlaps).toEqual([0, 0, 0]);

  await scroll.evaluate((element) => { element.scrollLeft = 0; });
  await expect(top).toBeHidden();
  await expect(bottom).toBeHidden();

  await scroll.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect(top).toBeVisible();
  await lastCell.focus();
  await page.keyboard.press("Tab");
  await expect(host.locator(".btn-table-control:focus-visible")).toBeVisible();
});
