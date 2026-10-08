import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { baseEditorExtensions, getExtensionsForMode } from "./markdown-mode";
import { isChartFencedCode } from "./code-block-widget";

vi.mock("../../features/links", () => ({
  resolveWikilink: vi.fn(() => Promise.resolve(null)),
  searchLinkIndex: vi.fn(() => Promise.resolve([])),
}));

vi.mock("chart.js", () => {
  const ChartMock = vi.fn(function ChartMock(this: { destroy: () => void }) { this.destroy = vi.fn(); });
  Object.assign(ChartMock, { register: vi.fn() });
  return { Chart: ChartMock, registerables: [] };
});

const CODE_DOCUMENT = "Before\n\n```javascript\nconst x = 1;\nconsole.log(x);\n```\n\nAfter";

function mount(mode: "edit-render" | "view" = "edit-render", doc = CODE_DOCUMENT) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [...baseEditorExtensions, ...getExtensionsForMode(mode)] }),
    parent,
  });
  return { view, parent };
}

describe("source-owned fenced code rendering", () => {
  const mounted: { view: EditorView; parent: HTMLDivElement }[] = [];
  afterEach(() => {
    for (const { view, parent } of mounted.splice(0)) {
      view.destroy();
      parent.remove();
    }
  });

  it("keeps code lines as CodeMirror text and hides only fence lines", () => {
    const mountedView = mount();
    mounted.push(mountedView);
    const { view } = mountedView;
    const bodyLines = view.dom.querySelectorAll(".cm-codeblock-line:not(.cm-codeblock-fence-line):not(.cm-codeblock-fence-edit)");
    expect(view.dom.querySelector(".cm-codeblock-widget-container")).toBeNull();
    expect(bodyLines).toHaveLength(2);
    expect(bodyLines[0].textContent).toBe("const x = 1;");
    expect(bodyLines[1].textContent).toBe("console.log(x);");
    expect(view.dom.querySelectorAll(".cm-codeblock-fence-placeholder")).toHaveLength(2);

    const bodyLine = view.state.doc.line(4);
    view.dispatch({ selection: { anchor: bodyLine.from + 4 } });
    expect(Array.from(view.dom.querySelectorAll(".cm-codeblock-fence-edit"), line => line.textContent)).toEqual(["```javascript", "```"]);
    expect(view.state.doc.sliceString(view.state.selection.main.head - 4, view.state.selection.main.head)).toBe("cons");
    expect(view.dom.querySelectorAll(".cm-codeblock-line:not(.cm-codeblock-fence-line):not(.cm-codeblock-fence-edit)")).toHaveLength(2);
  });

  it("keeps code selectable in read-only view without enabling edits", () => {
    const mountedView = mount("view");
    mounted.push(mountedView);
    const { view } = mountedView;
    expect(view.state.facet(EditorState.readOnly)).toBe(true);
    expect(view.contentDOM.getAttribute("contenteditable")).toBe("false");
    expect(view.dom.querySelector(".cm-codeblock-widget-container")).toBeNull();
    expect(view.dom.querySelectorAll(".cm-codeblock-line:not(.cm-codeblock-fence-line):not(.cm-codeblock-fence-edit)")).toHaveLength(2);
  });

  it("keeps an unterminated fence's final source line and leaves chart ownership alone", () => {
    const openFence = mount("edit-render", "```text\nfirst\nlast");
    mounted.push(openFence);
    expect(openFence.view.dom.querySelectorAll(".cm-codeblock-line:not(.cm-codeblock-fence-line):not(.cm-codeblock-fence-edit)")).toHaveLength(2);
    expect(openFence.view.dom.querySelector(".cm-codeblock-line-last")?.textContent).toBe("last");

    const chart = mount("edit-render", "```chart\ntype: bar\n```");
    mounted.push(chart);
    const chartStart = chart.view.state.doc.line(1).from;
    expect(isChartFencedCode(chart.view.state, chartStart)).toBe(true);
    expect(chart.view.dom.querySelector(".cm-chart-widget-container")).not.toBeNull();
    expect(chart.view.dom.querySelectorAll(".cm-codeblock-line")).toHaveLength(0);
  });

  it("does not give code blocks atomic ranges", () => {
    const mountedView = mount();
    mounted.push(mountedView);
    const { view } = mountedView;
    let from = -1;
    let to = -1;
    syntaxTree(view.state).iterate({
      enter(node) {
        if (node.name === "FencedCode") { from = node.from; to = node.to; }
      },
    });
    const atomicProviders = view.state.facet(EditorView.atomicRanges);
    expect(atomicProviders.every((provider) => {
      let found = false;
      provider(view).between(from, to, () => { found = true; });
      return !found;
    })).toBe(true);
  });
});
