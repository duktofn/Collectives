import { describe, it, expect, afterEach, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import {
  baseEditorExtensions,
  getExtensionsForMode,
} from "./markdown-mode";
import { REPRO_DOCS } from "./heightmap-test-fixtures";
import { isChartFencedCode, isCursorInFencedCode } from "./code-block-widget";

vi.mock("../tauri", () => ({
  resolveWikilink: vi.fn(() => Promise.resolve(null)),
  searchLinkIndex: vi.fn(() => Promise.resolve([])),
}));

vi.mock("chart.js", () => {
  const ChartMock = vi.fn(function ChartMock(this: { destroy: () => void }) {
    this.destroy = vi.fn();
  });
  Object.assign(ChartMock, { register: vi.fn() });
  return { Chart: ChartMock, registerables: [] };
});

function mountEditorView(doc: string, mode: "edit-source" | "edit-render") {
  const parent = document.createElement("div");
  parent.style.cssText =
    "position:absolute;top:0;left:0;width:800px;height:600px;overflow:hidden;";
  document.body.appendChild(parent);

  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        ...baseEditorExtensions,
        ...getExtensionsForMode(mode),
      ],
    }),
    parent,
  });

  view.requestMeasure();
  return { view, parent };
}

function countFencedCodeNodes(state: EditorState): number {
  let count = 0;
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "FencedCode") count++;
    },
  });
  return count;
}

describe("Bug #6 repro fixtures", () => {
  it("defines five minimal repro documents", () => {
    expect(Object.keys(REPRO_DOCS)).toEqual([
      "plain",
      "heading",
      "codeBlock",
      "chart",
      "table",
    ]);
  });

  it("edit-render loads more extensions than edit-source", () => {
    const source = getExtensionsForMode("edit-source");
    const render = getExtensionsForMode("edit-render");
    expect(render.length).toBeGreaterThan(source.length);
  });
});

describe("HeightMap layout (edit-render)", () => {
  const mounts: { view: EditorView; parent: HTMLDivElement }[] = [];

  afterEach(() => {
    for (const { view, parent } of mounts.splice(0)) {
      view.destroy();
      parent.remove();
    }
  });

  function create(doc: string) {
    const mounted = mountEditorView(doc, "edit-render");
    mounts.push(mounted);
    return mounted.view;
  }

  it("renders code block preview widget when cursor is outside the block", () => {
    const view = create(REPRO_DOCS.codeBlock);
    expect(isCursorInFencedCode(view.state, 0)).toBe(false);
    expect(view.dom.querySelector(".cm-codeblock-widget-container")).not.toBeNull();
    expect(countFencedCodeNodes(view.state)).toBe(1);
  });

  it("shows source lines when cursor moves inside a code block", () => {
    const view = create(REPRO_DOCS.codeBlock);
    const codeLine = view.state.doc.line(4);
    view.dispatch({
      selection: { anchor: codeLine.from },
    });
    expect(isCursorInFencedCode(view.state, codeLine.from)).toBe(true);
    expect(view.dom.querySelector(".cm-codeblock-widget-container")).toBeNull();
    expect(view.dom.querySelector(".cm-codeblock-line")).not.toBeNull();
  });

  it("skips chart blocks for fenced-code render decorations", () => {
    const view = create(REPRO_DOCS.chart);
    const chartFenceFrom = view.state.doc.line(3).from;
    expect(isChartFencedCode(view.state, chartFenceFrom)).toBe(true);
    expect(view.dom.querySelector(".cm-codeblock-widget-container")).toBeNull();
    expect(view.dom.querySelector(".cm-chart-widget-container")).not.toBeNull();
  });

  it("renders table widget without code-block preview interference", () => {
    const view = create(REPRO_DOCS.table);
    expect(view.dom.querySelector(".cm-table-widget-container")).not.toBeNull();
    expect(view.dom.querySelector(".cm-codeblock-widget-container")).toBeNull();
  });

  it("edit-source has no render widgets", () => {
    const { view, parent } = mountEditorView(REPRO_DOCS.codeBlock, "edit-source");
    mounts.push({ view, parent });
    expect(view.dom.querySelector(".cm-codeblock-widget-container")).toBeNull();
    expect(view.dom.querySelector(".cm-table-widget-container")).toBeNull();
  });
});

describe("code-block helpers", () => {
  it("detects cursor inside fenced code when selection is in block", () => {
    const state = EditorState.create({
      doc: REPRO_DOCS.codeBlock,
      extensions: baseEditorExtensions,
    });
    const codeLine = state.doc.line(4);
    const stateWithSel = state.update({
      selection: { anchor: codeLine.from },
    }).state;
    expect(isCursorInFencedCode(stateWithSel, codeLine.from)).toBe(true);
  });

  it("identifies chart fenced code by opening fence", () => {
    const state = EditorState.create({
      doc: REPRO_DOCS.chart,
      extensions: baseEditorExtensions,
    });
    expect(isChartFencedCode(state, state.doc.line(3).from)).toBe(true);
    expect(isChartFencedCode(state, state.doc.line(1).from)).toBe(false);
  });
});

describe("editorMeasure registry", () => {
  it("invokes registered measure callback", async () => {
    const { registerEditorMeasureRequest, requestEditorMeasure } = await import(
      "../editorMeasure"
    );
    const fn = vi.fn();
    const unregister = registerEditorMeasureRequest(fn);
    requestEditorMeasure();
    expect(fn).toHaveBeenCalledOnce();
    unregister();
  });
});
