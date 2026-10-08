import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { insertMarkdownTemplate } from "./editorCommands";

function createView(doc: string, editable = true) {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [markdown(), history(), EditorView.editable.of(editable)],
    }),
    parent: document.body,
  });
  return view;
}

describe("Markdown template insertion", () => {
  it("inserts a table as one undoable transaction", () => {
    const view = createView("Start\nEnd");
    view.dispatch({ selection: { anchor: 6 } });

    expect(insertMarkdownTemplate(view, "table")).toBe(true);
    expect(view.state.doc.toString()).toContain("| Column 1 | Column 2 |");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("Start\nEnd");
    view.destroy();
  });

  it("refuses insertion inside fenced code and read-only documents", () => {
    const source = "before\n\n```ts\nconst value = 1\n```\nafter";
    const codeView = createView(source);
    codeView.dispatch({ selection: { anchor: source.indexOf("value") } });
    expect(insertMarkdownTemplate(codeView, "heading")).toBe(false);
    expect(codeView.state.doc.toString()).toBe(source);
    codeView.destroy();

    const readonlyView = createView("note", false);
    expect(insertMarkdownTemplate(readonlyView, "checklist")).toBe(false);
    expect(readonlyView.state.doc.toString()).toBe("note");
    readonlyView.destroy();
  });
});

