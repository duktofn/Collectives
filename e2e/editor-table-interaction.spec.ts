import { expect, test, type Page } from "@playwright/test";

async function mountTableEditor(page: Page) {
  await page.evaluate(async () => {
    const host = document.createElement("div");
    host.id = "table-interaction-host";
    host.style.cssText = "position: fixed; z-index: 9999; top: 16px; left: 16px; width: 620px; height: 520px; overflow: hidden; background: var(--bg-primary);";
    document.body.appendChild(host);
    const fixture = await import("/src/visual-fixtures/editorTableFixture.ts");
    fixture.mountTableInteractionFixture(host);
  });
  await expect(page.locator("#table-interaction-host .cm-table-widget")).toBeVisible();
}

test("table cells render safely, edit source, and expose row and column controls", async ({ page }) => {
  await page.goto("/e2e/editor-interaction.html", { waitUntil: "commit" });
  await mountTableEditor(page);
  const table = page.locator("#table-interaction-host .cm-table-widget");
  await expect(table.locator("strong")).toHaveText("bold text");
  await expect(table.locator("em")).toHaveText("italic text");
  await expect(table.locator("code")).toHaveText("left|right");
  await expect(page.locator("#table-interaction-host .cm-table-widget")).toHaveCount(1);
  const alignment = await page.evaluate(() => {
    const shell = document.querySelector('#table-interaction-host .cm-table-widget-container') as HTMLElement;
    const scroll = shell.querySelector('.cm-table-scroll') as HTMLElement;
    return { shell: shell.getBoundingClientRect().left, scroll: scroll.getBoundingClientRect().left, width: shell.getBoundingClientRect().width, scrollbar: getComputedStyle(scroll).scrollbarWidth };
  });
  expect(Math.abs(alignment.shell - alignment.scroll)).toBeLessThan(2);
  expect(alignment.width).toBeLessThanOrEqual(620);
  expect(alignment.scrollbar).toBe('thin');
  await page.screenshot({ path: 'artifacts/ux-islands/table-left-aligned.png' });

  const boldCell = page.locator('#table-interaction-host [data-row-index="0"][data-column-index="0"]');
  await boldCell.click();
  await expect(boldCell).toHaveAttribute("contenteditable", "true");
  await expect(boldCell).toHaveText("**bold text**");
  await boldCell.fill("**bold text**!");
  await expect.poll(() => page.evaluate(() => {
    const view = (window as unknown as { __tableInteractionView: import("@codemirror/view").EditorView }).__tableInteractionView;
    return view.state.doc.toString();
  })).toContain("**bold text**!");
  await boldCell.press("Enter");
  await expect(boldCell).toHaveText("bold text!");
  await expect(boldCell.locator("strong")).toHaveText("bold text");

  await boldCell.click();
  await boldCell.press("End");
  await boldCell.pressSequentially("discard");
  await expect.poll(() => page.evaluate(() => {
    const view = (window as unknown as { __tableInteractionView: import("@codemirror/view").EditorView }).__tableInteractionView;
    return view.state.doc.toString();
  })).toContain("**bold text**!discard");
  await boldCell.press("Escape");
  await expect(boldCell).toHaveText("bold text!");
  await expect.poll(() => page.evaluate(() => {
    const view = (window as unknown as { __tableInteractionView: import("@codemirror/view").EditorView }).__tableInteractionView;
    return view.state.doc.toString();
  })).toContain("**bold text**!");

  await boldCell.click();
  await boldCell.press("Tab");
  const italicCell = page.locator('#table-interaction-host [data-row-index="0"][data-column-index="1"]');
  await expect(italicCell).toHaveAttribute("contenteditable", "true");
  await expect(italicCell).toHaveText("_italic text_");
  await italicCell.press("Shift+Tab");
  await expect(boldCell).toHaveAttribute("contenteditable", "true");

  await boldCell.hover();
  const addRow = page.getByRole("button", { name: "+ Add row below row 1" });
  await expect(addRow).toBeVisible();
  await addRow.click();
  await expect(table.locator("tbody tr")).toHaveCount(3);
  const topAddColumn = page.getByRole("button", { name: "+ Add column right of column 1" }).first();
  await expect(topAddColumn).toBeVisible();
  await topAddColumn.click();
  await expect(table.locator("thead th")).toHaveCount(4);

  const bottomAddColumn = page.locator('#table-interaction-host [data-column-controls="1"][data-edge="bottom"] button').first();
  await expect(bottomAddColumn).toBeVisible();
  await bottomAddColumn.click();
  await expect(table.locator("thead th")).toHaveCount(5);
  await expect(table.locator("tbody tr")).toHaveCount(3);
});

test("read-only table view has no edit controls or contenteditable cells", async ({ page }) => {
  await page.goto("/e2e/editor-interaction.html", { waitUntil: "commit" });
  await page.evaluate(async () => {
    const host = document.createElement("div");
    host.id = "readonly-table-host";
    host.style.cssText = "position: fixed; top: 16px; left: 16px; width: 620px; height: 520px;";
    document.body.appendChild(host);
    const fixture = await import("/src/visual-fixtures/editorTableFixture.ts");
    fixture.mountTableInteractionFixture(host, "view");
  });
  await expect(page.locator("#readonly-table-host .cm-table-widget")).toBeVisible();
  await expect(page.locator("#readonly-table-host .cm-table-control-group")).toHaveCount(0);
  await expect(page.locator('#readonly-table-host .cm-table-widget [contenteditable="true"]')).toHaveCount(0);
});

test("row and column controls delete the active index and preserve a valid table", async ({ page }) => {
  await page.goto("/e2e/editor-interaction.html", { waitUntil: "commit" });
  await mountTableEditor(page);
  const table = page.locator("#table-interaction-host .cm-table-widget");

  await page.locator('#table-interaction-host [data-row-index="1"][data-column-index="0"]').hover();
  await page.getByRole("button", { name: "− Delete row 2" }).click();
  await expect(table.locator("tbody tr")).toHaveCount(1);

  await page.locator('#table-interaction-host [data-row-index="0"][data-column-index="0"]').hover();
  await page.getByRole("button", { name: "− Delete row 1" }).click();
  await expect(table.locator("tbody tr")).toHaveCount(0);
  await expect(table.locator("thead th")).toHaveCount(3);

  const headerRowControls = page.locator('#table-interaction-host [data-row-controls="-1"]');
  await expect(headerRowControls.getByRole("button")).toHaveCount(1);
  const addFirstRow = headerRowControls.getByRole("button", { name: "+ Add row below header row" });
  await expect(addFirstRow).toBeVisible();
  await addFirstRow.click();
  await expect(table.locator("tbody tr")).toHaveCount(1);

  await page.locator('#table-interaction-host [data-row-index="-1"][data-column-index="0"]').hover({ position: { x: 32, y: 8 } });
  await page.locator('#table-interaction-host [data-column-controls="0"][data-edge="top"] button[aria-label="− Delete column 1"]').click();
  await expect(table.locator("thead th")).toHaveCount(2);

  await page.locator('#table-interaction-host [data-row-index="-1"][data-column-index="0"]').hover({ position: { x: 32, y: 8 } });
  await page.locator('#table-interaction-host [data-column-controls="0"][data-edge="bottom"] button[aria-label="− Delete column 1"]').click();
  await expect(table.locator("thead th")).toHaveCount(1);

  const deleteLastColumn = page.locator('#table-interaction-host [data-column-controls="0"] button[aria-label="− Delete column 1"]');
  await expect(deleteLastColumn).toHaveCount(2);
  await expect(deleteLastColumn.nth(0)).toBeDisabled();
  await expect(deleteLastColumn.nth(1)).toBeDisabled();
  await deleteLastColumn.nth(1).click({ force: true });
  await expect(table.locator("thead th")).toHaveCount(1);
});

test("table cell input pairs Markdown delimiters without duplicating closers", async ({ page }) => {
  await page.goto("/e2e/editor-interaction.html", { waitUntil: "commit" });
  await mountTableEditor(page);
  const cell = page.locator('#table-interaction-host [data-row-index="1"][data-column-index="1"]');
  await cell.click();
  await cell.fill("");
  await cell.pressSequentially("**fresh**");

  await expect.poll(() => page.evaluate(() => {
    const view = (window as unknown as { __tableInteractionView: import("@codemirror/view").EditorView }).__tableInteractionView;
    return view.state.doc.toString();
  })).toContain("| **fresh** |");
});
