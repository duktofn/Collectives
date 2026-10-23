import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { forceParsing, syntaxTree } from "@codemirror/language";
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
  it("reuses unchanged table models across tail edits and repeated lookups", () => {
    const doc = Array.from({ length: 12 }, (_, index) =>
      `| A ${index} | B |\n| --- | --- |\n| **bold** | a\\|b |\n\n`).join("") + "Tail";
    const state = EditorState.create({ doc, extensions: baseEditorExtensions });
    const before = findTables(state);
    expect(before).toHaveLength(12);
    expect(findTables(state)).toBe(before);
    const after = state.update({ changes: { from: doc.length, insert: "!" } }).state;
    const tables = findTables(after);
    expect(tables).toEqual(before);
    expect(tables[0]).toBe(before[0]);
    expect(tables[10]).toBe(before[10]);
  });

  it("maps every cell and nested inline offset after an insertion before tables", () => {
    const doc = "Before\n\n| A | B |\n| --- | --- |\n| **bold _nested_** | `pipe|code` |\n\nTail";
    const state = EditorState.create({ doc, extensions: baseEditorExtensions });
    findTables(state);
    const next = state.update({ changes: { from: 0, insert: "😀 prefix\n\n" } }).state;
    const fresh = EditorState.create({ doc: next.doc, extensions: baseEditorExtensions });
    expect(findTables(next)).toEqual(findTables(fresh));
    const reverted = next.update({ changes: { from: 0, to: "😀 prefix\n\n".length } }).state;
    expect(findTables(reverted)).toEqual(findTables(state));
  });

  it("reparses changed same-length cell text and removes tables changed into code", () => {
    const doc = "| A |\n| --- |\n| **old** |\n\nTail";
    const state = EditorState.create({ doc, extensions: baseEditorExtensions });
    const before = findTables(state)[0];
    const from = doc.indexOf("old");
    const changed = state.update({ changes: { from, to: from + 3, insert: "new" } }).state;
    expect(findTables(changed)[0].rows[0][0].source).toBe("**new**");
    expect(findTables(changed)[0]).not.toBe(before);
    const fenced = changed.update({ changes: [{ from: 0, insert: "```md\n" }, { from: changed.doc.length, insert: "\n```" }] }).state;
    expect(findTables(fenced)).toEqual([]);
  });

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

  it("does not mutate cached alignments when changing the table shape", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ parent, state: EditorState.create({
      doc: "| A | B |\n| :--- | ---: |\n| first | second |",
      extensions: [...baseEditorExtensions, ...getExtensionsForMode("edit-render")],
    }) });
    mounted.push({ view, parent });
    const before = findTables(view.state)[0];
    const button = Array.from(view.dom.querySelectorAll<HTMLButtonElement>("button"))
      .find(button => button.getAttribute("aria-label") === "+ Add column right of column 1");
    expect(button).toBeDefined();
    button!.click();
    // jsdom has no scrolling implementation; the deferred focus uses these cells.
    for (const cell of view.dom.querySelectorAll<HTMLElement>(".cm-table-widget th, .cm-table-widget td"))
      cell.scrollIntoView = vi.fn();
    expect(before.alignments).toEqual(["left", "right"]);
    expect(findTables(view.state)[0].headers).toHaveLength(3);
  });

  it("renders a table discovered after switching to a partially parsed document", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const extensions = [...baseEditorExtensions, ...getExtensionsForMode("edit-render")];
    const view = new EditorView({ state: EditorState.create({ doc: "First file", extensions }), parent });
    mounted.push({ view, parent });
    const table = "| API | Behavior |\n| --- | --- |\n| `Tick()` | Update state |";
    const source = "Paragraph before the table.\n\n".repeat(500) + table;
    view.setState(EditorState.create({ doc: source, extensions }));
    expect(findTables(view.state)).toHaveLength(0);
    const initialTree = syntaxTree(view.state);
    const initialDocument = view.state.doc;

    // Background parsing publishes a new tree without editing the document.
    expect(forceParsing(view, source.length, 1000)).toBe(true);
    expect(syntaxTree(view.state)).not.toBe(initialTree);
    expect(view.state.doc).toBe(initialDocument);
    expect(findTables(view.state)).toHaveLength(1);
    const tableRanges: { from: number; to: number }[] = [];
    for (const decorations of view.state.facet(EditorView.decorations)) {
      const ranges = typeof decorations === "function" ? decorations(view) : decorations;
      ranges.between(0, source.length, (from, to, decoration) => {
        if (decoration.spec.widget?.table) tableRanges.push({ from, to });
      });
    }
    expect(tableRanges).toEqual([{ from: source.indexOf(table), to: source.length }]);
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
