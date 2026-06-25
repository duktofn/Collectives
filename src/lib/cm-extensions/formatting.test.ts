import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import {
  buildLinePrefixSpec,
  buildListIndentSpec,
  buildToggleCodeBlockSpec,
  buildToggleWrapSpec,
  findEnclosingFencedBlock,
  isEmptyPairAt,
  isListLine,
  isWrappedBy,
} from "./formatting-utils";
import {
  asymmetricBackspace,
  asymmetricForwardDelete,
  handleDelimiterInput,
  handleOvertypeClose,
} from "./delimiter-pairs";

function stateWithDoc(doc: string, selection?: { anchor: number; head?: number }) {
  return EditorState.create({
    doc,
    selection: selection
      ? { anchor: selection.anchor, head: selection.head ?? selection.anchor }
      : undefined,
  });
}

function mountView(doc: string, anchor: number) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [markdown()],
      selection: { anchor },
    }),
    parent,
  });
  return { view, parent };
}

describe("formatting-utils", () => {
  it("detects list lines", () => {
    expect(isListLine("- item")).toBe(true);
    expect(isListLine("  1. item")).toBe(true);
    expect(isListLine("* item")).toBe(true);
    expect(isListLine("plain")).toBe(false);
  });

  it("wraps a selection with bold markers", () => {
    const state = stateWithDoc("hello world", { anchor: 0, head: 5 });
    const spec = buildToggleWrapSpec(state, "**", "**");
    expect(spec?.changes).toEqual({
      from: 0,
      to: 5,
      insert: "**hello**",
    });
  });

  it("unwraps bold when markers are present", () => {
    const state = stateWithDoc("**hello**", { anchor: 2, head: 7 });
    expect(isWrappedBy(state.doc, 2, 7, "**", "**")).toBe(true);
    const spec = buildToggleWrapSpec(state, "**", "**");
    expect(spec?.changes).toEqual([
      { from: 0, to: 2, insert: "" },
      { from: 7, to: 9, insert: "" },
    ]);
  });

  it("inserts empty bold pair at cursor", () => {
    const state = stateWithDoc("text", { anchor: 2 });
    const spec = buildToggleWrapSpec(state, "**", "**");
    expect(spec?.changes).toEqual({ from: 2, to: 2, insert: "****" });
    expect(spec?.selection).toEqual({ anchor: 4 });
  });

  it("unwraps empty bold pair at cursor", () => {
    const state = stateWithDoc("a****b", { anchor: 3 });
    expect(isEmptyPairAt(state.doc, 3, "**", "**")).toBe(true);
    const spec = buildToggleWrapSpec(state, "**", "**");
    expect(spec?.changes).toEqual([
      { from: 1, to: 3, insert: "" },
      { from: 3, to: 5, insert: "" },
    ]);
  });

  it("does not treat bold as italic", () => {
    const state = stateWithDoc("**hello**", { anchor: 2, head: 7 });
    expect(isWrappedBy(state.doc, 2, 7, "*", "*", { singleChar: true })).toBe(false);
  });

  it("unwraps italic markers", () => {
    const state = stateWithDoc("*hello*", { anchor: 1, head: 6 });
    expect(isWrappedBy(state.doc, 1, 6, "*", "*", { singleChar: true })).toBe(true);
  });

  it("toggles unordered list prefix on a line", () => {
    const state = stateWithDoc("item", { anchor: 0 });
    const add = buildLinePrefixSpec(state, "unordered");
    expect(add?.changes).toEqual([{ from: 0, to: 0, insert: "- " }]);

    const withPrefix = stateWithDoc("- item", { anchor: 0 });
    const remove = buildLinePrefixSpec(withPrefix, "unordered");
    expect(remove?.changes).toEqual([{ from: 0, to: 2, insert: "" }]);
  });

  it("indents and unindents list items", () => {
    const state = stateWithDoc("- item", { anchor: 2 });
    expect(buildListIndentSpec(state, 2)?.changes).toEqual({
      from: 0,
      to: 0,
      insert: "  ",
    });

    const indented = stateWithDoc("  - item", { anchor: 4 });
    expect(buildListIndentSpec(indented, -2)?.changes).toEqual({
      from: 0,
      to: 2,
      insert: "",
    });
  });

  it("inserts an empty fenced code block at cursor", () => {
    const state = stateWithDoc("text", { anchor: 2 });
    const spec = buildToggleCodeBlockSpec(state);
    expect(spec.changes).toEqual({ from: 2, to: 2, insert: "```\n\n```" });
    expect(spec.selection).toEqual({ anchor: 6 });
  });

  it("wraps a selection in a fenced code block", () => {
    const state = stateWithDoc("const x = 1", { anchor: 0, head: 11 });
    const spec = buildToggleCodeBlockSpec(state);
    expect(spec.changes).toEqual({
      from: 0,
      to: 11,
      insert: "```\nconst x = 1\n```",
    });
  });

  it("unwraps a fenced code block", () => {
    const doc = "```\ncode\n```";
    const state = stateWithDoc(doc, { anchor: 5, head: 9 });
    expect(findEnclosingFencedBlock(state, state.selection.main.from, state.selection.main.to)).not.toBeNull();
    const spec = buildToggleCodeBlockSpec(state);
    expect(spec.changes).toEqual({ from: 0, to: doc.length, insert: "code" });
  });
});

describe("delimiter-pairs", () => {
  it("auto-pairs parentheses", () => {
    const { view, parent } = mountView("", 0);
    expect(handleDelimiterInput(view, 0, 0, "(")).toBe(true);
    expect(view.state.doc.toString()).toBe("()");
    expect(view.state.selection.main.head).toBe(1);
    view.destroy();
    parent.remove();
  });

  it("auto-pairs square brackets", () => {
    const { view, parent } = mountView("", 0);
    expect(handleDelimiterInput(view, 0, 0, "[")).toBe(true);
    expect(view.state.doc.toString()).toBe("[]");
    view.destroy();
    parent.remove();
  });

  it("does not double-pair the second bracket in wikilinks", () => {
    const { view, parent } = mountView("[", 1);
    expect(handleDelimiterInput(view, 1, 1, "[")).toBe(true);
    expect(view.state.doc.toString()).toBe("[[");
    expect(view.state.selection.main.head).toBe(2);
    view.destroy();
    parent.remove();
  });

  it("wraps a selection with delimiters", () => {
    const { view, parent } = mountView("text", 0);
    view.dispatch({ selection: { anchor: 0, head: 4 } });
    expect(handleDelimiterInput(view, 0, 4, "(")).toBe(true);
    expect(view.state.doc.toString()).toBe("(text)");
    view.destroy();
    parent.remove();
  });

  it("overtypes a closing delimiter", () => {
    const { view, parent } = mountView("()", 1);
    expect(handleOvertypeClose(view, 1, 1, ")")).toBe(true);
    expect(view.state.doc.toString()).toBe("()");
    expect(view.state.selection.main.head).toBe(2);
    view.destroy();
    parent.remove();
  });

  it("deletes only the opening delimiter on backspace", () => {
    const { view, parent } = mountView("()", 1);
    expect(asymmetricBackspace(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(")");
    expect(view.state.selection.main.head).toBe(0);
    view.destroy();
    parent.remove();
  });

  it("deletes only the closing delimiter on delete", () => {
    const { view, parent } = mountView("()", 1);
    expect(asymmetricForwardDelete(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("(");
    expect(view.state.selection.main.head).toBe(1);
    view.destroy();
    parent.remove();
  });
});
