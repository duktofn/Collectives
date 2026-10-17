import { expect, test, type Page } from "@playwright/test";
import { installWorkspaceMock } from "./helpers/workspaceMock";

test("Write renders a late table after file switches without toggling modes", async ({ page }) => {
  const table = [
    "| API | Hành vi |",
    "| --- | --- |",
    "| `Tick()` / `FixedTick()` | Kiểm tra transition |",
    "| `SetState(IState<TContext>)` | Enter state mới |",
  ].join("\n");
  await installWorkspaceMock(page, "dark", false, false, undefined, undefined, {
    "First.md": "# First file\n\nA short note.",
    "Long table.md": "Paragraph before the table.\n\n".repeat(500) + table + "\n\nEnd of note.",
  });
  await page.goto("/e2e/workspace.html");
  await expect(page.locator(".cm-content")).toContainText("A short note.");
  for (let visit = 0; visit < 3; visit++) {
    await page.getByRole("treeitem", { name: /^Long table/ }).click();
    const content = page.locator(".cm-content");
    await expect(content).toContainText("Paragraph before the table.");
    await content.focus();
    await page.keyboard.press("Control+End");
    const rendered = page.locator(".cm-table-widget");
    await expect(rendered).toBeVisible();
    await expect(rendered.locator("th")).toHaveText(["API", "Hành vi"]);
    await expect(rendered.locator("tbody tr")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Write", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("treeitem", { name: /^First/ }).click();
    await expect(content).toContainText("A short note.");
    await expect(rendered).toHaveCount(0);
  }
});

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

test("plus inserts below or right and minus deletes the indicated row or column", async ({ page }) => {
  await page.goto("/e2e/editor-interaction.html", { waitUntil: "commit" });
  await mountTableEditor(page);
  await page.evaluate(() => {
    const view = (window as any).__tableInteractionView;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert:
      "Table operations.\n\n| A | B | C |\n| --- | --- | --- |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n| a3 | b3 | c3 |" } });
  });
  const host = page.locator("#table-interaction-host");
  const rows = host.locator("tbody tr");
  const headers = host.locator("thead th");
  const cell = (row: number, column: number) => host.locator(`[data-row-index="${row}"][data-column-index="${column}"]`);
  const columnButton = (column: number, edge: "top" | "bottom", name: string) =>
    host.locator(`[data-column-controls="${column}"][data-edge="${edge}"]`).getByRole("button", { name, exact: true });

  await cell(1, 1).click();
  await host.getByRole("button", { name: "+ Add row below row 2", exact: true }).click();
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0).locator("td")).toHaveText(["a1", "b1", "c1"]);
  await expect(rows.nth(1).locator("td")).toHaveText(["a2", "b2", "c2"]);
  await expect(rows.nth(2).locator("td")).toHaveText(["", "", ""]);
  await expect(rows.nth(3).locator("td")).toHaveText(["a3", "b3", "c3"]);
  await cell(1, 1).click();
  await host.getByRole("button", { name: "− Delete row 2", exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1).locator("td")).toHaveText(["", "", ""]);
  await expect(rows.nth(2).locator("td")).toHaveText(["a3", "b3", "c3"]);

  await cell(0, 1).click();
  await columnButton(1, "top", "+ Add column right of column 2").click();
  await expect(headers).toHaveText(["A", "B", "Column 3", "C"]);
  await expect(rows.nth(0).locator("td")).toHaveText(["a1", "b1", "", "c1"]);
  await cell(0, 1).click();
  await columnButton(1, "bottom", "− Delete column 2").click();
  await expect(headers).toHaveText(["A", "Column 3", "C"]);
  await expect(rows.nth(0).locator("td")).toHaveText(["a1", "", "c1"]);
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
