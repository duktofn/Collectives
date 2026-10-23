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

  it("keeps fence decorations mapped after edits before an adjacent table", () => {
    const doc = "Before\n\n| A | B |\n| --- | --- |\n| **bold** | `pipe|value` |\n\n```text\nbody\n```\n\nAfter";
    const editor = mount("edit-render", doc);
    mounted.push(editor);
    const prefix = "😀 prefix\n\n";
    editor.view.dispatch({ changes: { from: 0, insert: prefix } });
    const ranges: { from: number; text: string }[] = [];
    for (const source of editor.view.state.facet(EditorView.decorations)) {
      const set = typeof source === "function" ? source(editor.view) : source;
      set.between(0, editor.view.state.doc.length, (from, _to, value) => {
        if (value.spec.class === "cm-codeblock-line cm-codeblock-line-first cm-codeblock-line-last")
          ranges.push({ from, text: editor.view.state.doc.lineAt(from).text });
      });
    }
    expect(ranges).toEqual([{ from: prefix.length + doc.indexOf("body"), text: "body" }]);
    expect(editor.view.state.doc.toString()).toBe(prefix + doc);
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
    expect(view.dom.querySelectorAll(".cm-codeblock-fence-placeholder")).toHaveLength(1);
    expect(view.dom.querySelector(".cm-codeblock-language-name")?.textContent).toBe("JavaScript");

    const bodyLine = view.state.doc.line(4);
    view.dispatch({ selection: { anchor: bodyLine.from + 4 } });
    expect(Array.from(view.dom.querySelectorAll(".cm-codeblock-fence-edit"), line => line.textContent)).toEqual(["```javascript", "```"]);
    expect(view.state.doc.sliceString(view.state.selection.main.head - 4, view.state.selection.main.head)).toBe("cons");
    expect(view.dom.querySelectorAll(".cm-codeblock-line:not(.cm-codeblock-fence-line):not(.cm-codeblock-fence-edit)")).toHaveLength(2);
  });

  it.each([
    ['cpp', 'C++'], ['c++', 'C++'], ['csharp', 'C#'], ['c#', 'C#'],
    ['json', 'JSON'], ['text', 'Text'], ['', 'Text'],
  ])('shows the language of a %s block in Read and Write', (language, label) => {
    for (const mode of ['view', 'edit-render'] as const) {
      const editor = mount(mode, `Before\n\n\`\`\`${language}\nexample\n\`\`\`\n\nAfter`);
      mounted.push(editor);
      expect(editor.view.dom.querySelector('.cm-codeblock-language-name')?.textContent).toBe(label);
      expect(editor.view.state.doc.toString()).toContain(`\`\`\`${language}\nexample`);
    }
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
