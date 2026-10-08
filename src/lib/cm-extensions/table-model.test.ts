import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { baseEditorExtensions, getExtensionsForMode } from "./markdown-mode";
import { findTables, serializeTable } from "./table-model";

vi.mock("../../features/links", () => ({
  resolveWikilink: vi.fn(() => Promise.resolve(null)),
  searchLinkIndex: vi.fn(() => Promise.resolve([])),
}));

vi.mock("chart.js", () => {
  const ChartMock = vi.fn(function ChartMock(this: { destroy: () => void }) { this.destroy = vi.fn(); });
  Object.assign(ChartMock, { register: vi.fn() });
  return { Chart: ChartMock, registerables: [] };
});

describe("Markdown table model", () => {
  it("uses parser tables, preserves inline source, escaped pipes, code pipes, and alignment", () => {
    const doc = [
      "| Name | Snippet | State |",
      "| :--- | ---: | :---: |",
      "| **Bold** | `a|b` | _ready_ |",
      "| Escaped | raw\\|pipe | plain |",
      "",
      "```md",
      "| example | not a table |",
      "| --- | --- |",
      "```",
    ].join("\n");
    const state = EditorState.create({ doc, extensions: baseEditorExtensions });
    const tables = findTables(state);
    expect(tables).toHaveLength(1);
    expect(tables[0].headers.map((cell) => cell.source)).toEqual(["Name", "Snippet", "State"]);
    expect(tables[0].rows[0].map((cell) => cell.source)).toEqual(["**Bold**", "`a|b`", "_ready_"]);
    expect(tables[0].rows[1][1].source).toBe("raw\\|pipe");
    expect(tables[0].alignments).toEqual(["left", "right", "center"]);
    expect(serializeTable({
      headers: tables[0].headers.map((cell) => cell.source),
      rows: tables[0].rows.map((row) => row.map((cell) => cell.source)),
      alignments: tables[0].alignments,
    })).toContain("| **Bold** | `a|b` | _ready_ |");
  });

  it("keeps zero-length cells in their column positions", () => {
    const state = EditorState.create({
      doc: "| A | B | C |\n| --- | --- | --- |\n| first |  | last |",
      extensions: baseEditorExtensions,
    });

    const table = findTables(state)[0];
    expect(table.rows[0].map((cell) => cell.source)).toEqual(["first", "", "last"]);
    expect(table.rows[0][1].from).toBe(table.rows[0][1].to);
  });
});

describe("Markdown table widget", () => {
  const mounted: { view: EditorView; parent: HTMLDivElement }[] = [];
  afterEach(() => {
    for (const { view, parent } of mounted.splice(0)) {
      view.destroy();
      parent.remove();
    }
  });

  it("renders inline markdown safely and switches focused cells to source text", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: "| A | B |\n| --- | --- |\n| **bold** | `a|b` |",
        extensions: [...baseEditorExtensions, ...getExtensionsForMode("edit-render")],
      }),
      parent,
    });
    mounted.push({ view, parent });

    expect(view.dom.querySelector(".cm-table-widget strong")?.textContent).toBe("bold");
    expect(view.dom.querySelector(".cm-table-widget code")?.textContent).toBe("a|b");
    expect(view.dom.querySelectorAll(".cm-table-widget [contenteditable='true']")).toHaveLength(0);

    const cell = view.dom.querySelector<HTMLElement>('[data-row-index="0"][data-column-index="0"]');
    expect(cell).not.toBeNull();
    cell?.focus();
    expect(cell?.getAttribute("contenteditable")).toBe("true");
    expect(cell?.textContent).toBe("**bold**");
    cell!.textContent = "**bold**!";
    cell!.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "!" }));
    expect(view.state.doc.toString()).toContain("**bold**!");
  });

  it("keeps the parser-owned table visible without editing controls in read-only view", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: "| A |\n| --- |\n| <img src=x onerror=alert(1)> |",
        extensions: [...baseEditorExtensions, ...getExtensionsForMode("view")],
      }),
      parent,
    });
    mounted.push({ view, parent });

    expect(view.dom.querySelector(".cm-table-widget-container")).not.toBeNull();
    expect(view.dom.querySelector(".cm-table-control-group")).toBeNull();
    expect(view.dom.querySelector(".cm-table-widget img")).toBeNull();
    expect(view.dom.querySelector(".cm-table-widget td")?.textContent).toContain("<img");
  });
});
